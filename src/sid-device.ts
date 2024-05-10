const SID_CHANNEL_AMOUNT = 3;
const OUTPUT_SCALEDOWN = 0x10000 * SID_CHANNEL_AMOUNT * 16;

// ADSR constants
// prettier-ignore
const ADSRperiods = [
  0, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251
];
const ADSRstep = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

//prescaler values that slow down the envelope-counter as it decays and approaches zero level
//pos0:1, pos6:30, pos14:16, pos26:8, pos54:4, pos93:2
const ADSR_exptable = [
  1, 30, 30, 30, 30, 30, 30, 16, 16, 16, 16, 16, 16, 16, 16, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];

// Waveforms
function createCombineWaveForm(bitmul: number, bitstrength: number, treshold: number) {
  const waveform = Array.from<number>({ length: 4096 });
  //I found out how the combined waveform works (neighboring bits affect each other recursively)
  for (let i = 0; i < 4096; i++) {
    let value = 0;
    //neighbour-bit strength and DAC MOSFET treshold is approximately set by ears'n'trials
    for (let j = 0; j < 12; j++) {
      let bitlevel = 0;
      for (let k = 0; k < 12; k++) {
        bitlevel += (bitmul / bitstrength ** Math.abs(k - j)) * (((i >> k) & 1) - 0.5);
      }
      value += bitlevel >= treshold ? 2 ** j : 0;
    }
    waveform[i] = value * 12;
  }
  return waveform;
}

//precalculate combined waveform
const TriSaw_8580 = createCombineWaveForm(0.8, 2.4, 0.64);
const PulseSaw_8580 = createCombineWaveForm(1.4, 1.9, 0.68);
const PulseTriSaw_8580 = createCombineWaveForm(0.8, 2.5, 0.64);

export function createSID(
  memory: Uint8Array,
  samplerate: number,
  clk_ratio: number,
  SID_model: number[],
) {
  ADSRperiods[0] = Math.max(clk_ratio, 9);
  ADSRstep[0] = Math.ceil(ADSRperiods[0] / 9);

  //SID emulation constants
  const GATE_BITMASK = 0x01;
  const SYNC_BITMASK = 0x02;
  const RING_BITMASK = 0x04;
  const TEST_BITMASK = 0x08;
  const TRI_BITMASK = 0x10;
  const SAW_BITMASK = 0x20;
  const PULSE_BITMASK = 0x40;
  const NOISE_BITMASK = 0x80;
  const HOLDZERO_BITMASK = 0x10;
  const DECAYSUSTAIN_BITMASK = 0x40;
  const ATTACK_BITMASK = 0x80;
  const FILTSW = [1, 2, 4, 1, 2, 4, 1, 2, 4] as const;
  const LOWPASS_BITMASK = 0x10;
  const BANDPASS_BITMASK = 0x20;
  const HIGHPASS_BITMASK = 0x40;
  const OFF3_BITMASK = 0x80;
  //SID emulation variables
  const ADSRstate = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const ratecnt = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const envcnt = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const expcnt = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const prevSR = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const phaseaccu = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const prevaccu = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const sourceMSBrise = [0, 0, 0];
  const sourceMSB = [0, 0, 0];
  const noise_LFSR = [
    0x7ffff8, 0x7ffff8, 0x7ffff8, 0x7ffff8, 0x7ffff8, 0x7ffff8, 0x7ffff8, 0x7ffff8, 0x7ffff8,
  ];
  const prevwfout = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const prevwavdata = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let combiwf;
  const prevlowpass = [0, 0, 0];
  const prevbandpass = [0, 0, 0];
  const cutoff_ratio_8580 = (-2 * 3.14 * (12500 / 256)) / samplerate;
  const cutoff_ratio_6581 = (-2 * 3.14 * (20000 / 256)) / samplerate;
  let period;
  let step;
  let accuadd;
  let MSB;
  let tmp;
  let pw;
  let lim;
  let wfout: number;
  let cutoff;
  let resonance;
  let filtin;
  let output: number;
  //registers: 0:freql1  1:freqh1  2:pwml1  3:pwmh1  4:ctrl1  5:ad1   6:sr1  7:freql2  8:freqh2  9:pwml2 10:pwmh2 11:ctrl2 12:ad2  13:sr 14:freql3 15:freqh3 16:pwml3 17:pwmh3 18:ctrl3 19:ad3  20:sr3
  //           21:cutoffl 22:cutoffh 23:flsw_reso 24:vol_ftype 25:potX 26:potY 27:OSC3 28:ENV3

  function init() {
    for (let i = 0xd400; i <= 0xd7ff; i++) memory[i] = 0;
    for (let i = 0xde00; i <= 0xdfff; i++) memory[i] = 0;
    for (let i = 0; i < 9; i++) {
      ADSRstate[i] = HOLDZERO_BITMASK;
      ratecnt[i] = envcnt[i] = expcnt[i] = prevSR[i] = 0;
    }
  }

  function emulate(num: number, SIDaddr: number) {
    //the SID emulation itself ('num' is the number of SID to iterate (0..2)
    filtin = 0;
    output = 0;

    //treating 2SID and 3SID channels uniformly (0..5 / 0..8), this probably avoids some extra code
    for (
      let channel = num * SID_CHANNEL_AMOUNT;
      channel < (num + 1) * SID_CHANNEL_AMOUNT;
      channel++
    ) {
      const prevgate = ADSRstate[channel] & GATE_BITMASK;
      const chnadd = SIDaddr + (channel - num * SID_CHANNEL_AMOUNT) * 7;
      const ctrl = memory[chnadd + 4];
      const wf = ctrl & 0xf0;
      const test = ctrl & TEST_BITMASK;
      const SR = memory[chnadd + 6];
      tmp = 0;

      //ADSR envelope generator:
      if (prevgate !== (ctrl & GATE_BITMASK)) {
        //gatebit-change?
        if (prevgate) {
          ADSRstate[channel] &= 0xff - (GATE_BITMASK | ATTACK_BITMASK | DECAYSUSTAIN_BITMASK);
        } //falling edge (with Whittaker workaround this never happens, but should be here)
        else {
          ADSRstate[channel] = GATE_BITMASK | ATTACK_BITMASK | DECAYSUSTAIN_BITMASK;
          //rising edge, also sets hold_zero_bit=0
          if ((SR & 0xf) > (prevSR[channel] & 0xf)) tmp = 1;
          //assume SR->GATE write order: workaround to have crisp soundstarts by triggering delay-bug
        }
        //(this is for the possible missed CTRL(GATE) vs SR register write order situations (1MHz CPU is cca 20 times faster than samplerate)
      }
      prevSR[channel] = SR;

      ratecnt[channel] += clk_ratio;
      if (ratecnt[channel] >= 0x8000) ratecnt[channel] -= 0x8000;
      //can wrap around (ADSR delay-bug: short 1st frame is usually achieved by utilizing this bug)

      //set ADSR period that should be checked against rate-counter (depending on ADSR state Attack/DecaySustain/Release)
      if (ADSRstate[channel] & ATTACK_BITMASK) {
        step = memory[chnadd + 5] >> 4;
        period = ADSRperiods[step];
      } else if (ADSRstate[channel] & DECAYSUSTAIN_BITMASK) {
        step = memory[chnadd + 5] & 0xf;
        period = ADSRperiods[step];
      } else {
        step = SR & 0xf;
        period = ADSRperiods[step];
      }
      step = ADSRstep[step];

      if (ratecnt[channel] >= period && ratecnt[channel] < period + clk_ratio && tmp === 0) {
        //ratecounter shot (matches rateperiod) (in genuine SID ratecounter is LFSR)
        ratecnt[channel] -= period;
        //compensation for timing instead of simply setting 0 on rate-counter overload
        if (
          ADSRstate[channel] & ATTACK_BITMASK ||
          ++expcnt[channel] === ADSR_exptable[envcnt[channel]]
        ) {
          if (!(ADSRstate[channel] & HOLDZERO_BITMASK)) {
            if (ADSRstate[channel] & ATTACK_BITMASK) {
              envcnt[channel] += step;
              if (envcnt[channel] >= 0xff) {
                envcnt[channel] = 0xff;
                ADSRstate[channel] &= 0xff - ATTACK_BITMASK;
              }
            } else if (
              !(ADSRstate[channel] & DECAYSUSTAIN_BITMASK) ||
              envcnt[channel] > (SR >> 4) + (SR & 0xf0)
            ) {
              envcnt[channel] -= step;
              if (envcnt[channel] <= 0 && envcnt[channel] + step !== 0) {
                envcnt[channel] = 0;
                ADSRstate[channel] |= HOLDZERO_BITMASK;
              }
            }
          }
          expcnt[channel] = 0;
        }
      }

      envcnt[channel] &= 0xff;
      //'envcnt' may wrap around in some cases, mostly 0 -> FF (e.g.: Cloudless Rain, Boombox Alley)

      //WAVE generation codes (phase accumulator and waveform-selector):  (They are explained in resid source, I won't go in details, the code speaks for itself.)
      accuadd = (memory[chnadd] + memory[chnadd + 1] * 256) * clk_ratio;
      if (test || (ctrl & SYNC_BITMASK && sourceMSBrise[num])) {
        phaseaccu[channel] = 0;
      } else {
        phaseaccu[channel] += accuadd;
        if (phaseaccu[channel] > 0xffffff) phaseaccu[channel] -= 0x1000000;
      }
      MSB = phaseaccu[channel] & 0x800000;
      sourceMSBrise[num] = MSB > (prevaccu[channel] & 0x800000) ? 1 : 0;
      //phaseaccu[channel] &= 0xFFFFFF;

      //waveform-selector:
      if (wf & NOISE_BITMASK) {
        //noise waveform
        tmp = noise_LFSR[channel];
        if (
          (phaseaccu[channel] & 0x100000) !== (prevaccu[channel] & 0x100000) ||
          accuadd >= 0x100000
        ) {
          //clock LFSR all time if clockrate exceeds observable at given samplerate
          step = (tmp & 0x400000) ^ ((tmp & 0x20000) << 5);
          tmp = ((tmp << 1) + (step > 0 || test)) & 0x7fffff;
          noise_LFSR[channel] = tmp;
        }
        //we simply zero output when other waveform is mixed with noise. On real SID LFSR continuously gets filled by zero and locks up. ($C1 waveform with pw<8 can keep it for a while...)
        wfout =
          wf & 0x70 ? 0 : (
            ((tmp & 0x100000) >> 5) +
            ((tmp & 0x40000) >> 4) +
            ((tmp & 0x4000) >> 1) +
            ((tmp & 0x800) << 1) +
            ((tmp & 0x200) << 2) +
            ((tmp & 0x20) << 5) +
            ((tmp & 0x04) << 7) +
            ((tmp & 0x01) << 8)
          );
      } else if (wf & PULSE_BITMASK) {
        //simple pulse
        pw = (memory[chnadd + 2] + (memory[chnadd + 3] & 0xf) * 256) * 16;
        tmp = accuadd >> 9;
        if (pw > 0 && pw < tmp) pw = tmp;
        tmp ^= 0xffff;
        if (pw > tmp) pw = tmp;
        tmp = phaseaccu[channel] >> 8;
        if (wf === PULSE_BITMASK) {
          step = 256 / (accuadd >> 16);
          //simple pulse, most often used waveform, make it sound as clean as possible without oversampling
          //One of my biggest success with the SwinSID-variant was that I could clean the high-pitched and thin sounds.
          //(You might have faced with the unpleasant sound quality of high-pitched sounds without oversampling. We need so-called 'band-limited' synthesis instead.
          // There are a lot of articles about this issue on the internet. In a nutshell, the harsh edges produce harmonics that exceed the
          // Nyquist frequency (samplerate/2) and they are folded back into hearable range, producing unvanted ringmodulation-like effect.)
          //After so many trials with dithering/filtering/oversampling/etc. it turned out I can't eliminate the fukkin aliasing in time-domain, as suggested at pages.
          //Oversampling (running the wave-generation 8 times more) was not a way at 32MHz SwinSID. It might be an option on PC but I don't prefer it in JavaScript.)
          //The only solution that worked for me in the end, what I came up eventually: The harsh rising and falling edges of the pulse are
          //elongated making it a bit trapezoid. But not in time-domain, but altering the transfer-characteristics. This had to be done
          //in a frequency-dependent way, proportionally to pitch, to keep the deep sounds crisp. The following code does this (my favourite testcase is Robocop3 intro):
          if (test) wfout = 0xffff;
          else if (tmp < pw) {
            lim = (0xffff - pw) * step;
            if (lim > 0xffff) lim = 0xffff;
            wfout = lim - (pw - tmp) * step;
            if (wfout < 0) wfout = 0;
          } //rising edge
          else {
            lim = pw * step;
            if (lim > 0xffff) lim = 0xffff;
            wfout = (0xffff - tmp) * step - lim;
            if (wfout >= 0) wfout = 0xffff;
            wfout &= 0xffff;
          }
          //falling edge
        } else {
          //combined pulse
          wfout = tmp >= pw || test ? 0xffff : 0;
          //(this would be enough for simple but aliased-at-high-pitches pulse)
          if (wf & TRI_BITMASK) {
            if (wf & SAW_BITMASK) {
              wfout = wfout ? combinedWaveForm(num, channel, PulseTriSaw_8580, tmp >> 4, 1) : 0;
            } //pulse+saw+triangle (waveform nearly identical to tri+saw)
            else {
              tmp = phaseaccu[channel] ^ (ctrl & RING_BITMASK ? sourceMSB[num] : 0);
              wfout =
                wfout ?
                  combinedWaveForm(
                    num,
                    channel,
                    PulseSaw_8580,
                    (tmp ^ (tmp & 0x800000 ? 0xffffff : 0)) >> 11,
                    0,
                  )
                : 0;
            }
          } //pulse+triangle
          else if (wf & SAW_BITMASK)
            wfout = wfout ? combinedWaveForm(num, channel, PulseSaw_8580, tmp >> 4, 1) : 0;
          //pulse+saw
        }
      } else if (wf & SAW_BITMASK) {
        //saw
        wfout = phaseaccu[channel] >> 8;
        //saw (this row would be enough for simple but aliased-at-high-pitch saw)
        //The anti-aliasing (cleaning) of high-pitched sawtooth wave works by the same principle as mentioned above for the pulse,
        //but the sawtooth has even harsher edge/transition, and as the falling edge gets longer, tha rising edge should became shorter,
        //and to keep the amplitude, it should be multiplied a little bit (with reciprocal of rising-edge steepness).
        //The waveform at the output essentially becomes an asymmetric triangle, more-and-more approaching symmetric shape towards high frequencies.
        //(If you check a recording from the real SID, you can see a similar shape, the high-pitch sawtooth waves are triangle-like...)
        //But for deep sounds the sawtooth is really close to a sawtooth, as there is no aliasing there, but deep sounds should be sharp...
        if (wf & TRI_BITMASK) wfout = combinedWaveForm(num, channel, TriSaw_8580, wfout >> 4, 1);
        //saw+triangle
        else {
          step = accuadd / 0x1200000;
          wfout += wfout * step;
          if (wfout > 0xffff) wfout = 0xffff - (wfout - 0x10000) / step;
        }
        //simple cleaned (bandlimited) saw
      } else if (wf & TRI_BITMASK) {
        //triangle (this waveform has no harsh edges, so it doesn't suffer from strong aliasing at high pitches)
        tmp = phaseaccu[channel] ^ (ctrl & RING_BITMASK ? sourceMSB[num] : 0);
        wfout = (tmp ^ (tmp & 0x800000 ? 0xffffff : 0)) >> 7;
      }

      if (wf) prevwfout[channel] = wfout;
      else {
        wfout = prevwfout[channel];
      }
      //emulate waveform 00 floating wave-DAC (on real SID waveform00 decays after 15s..50s depending on temperature?)
      prevaccu[channel] = phaseaccu[channel];
      sourceMSB[num] = MSB;
      //(So the decay is not an exact value. Anyway, we just simply keep the value to avoid clicks and support SounDemon digi later...)

      //routing the channel signal to either the filter or the unfiltered master output depending on filter-switch SID-registers
      if (memory[SIDaddr + 0x17] & FILTSW[channel])
        filtin += (wfout - 0x8000) * (envcnt[channel] / 256);
      else if (channel % SID_CHANNEL_AMOUNT !== 2 || !(memory[SIDaddr + 0x18] & OFF3_BITMASK))
        output += (wfout - 0x8000) * (envcnt[channel] / 256);
    }

    //update readable SID-registers (some SID tunes might use 3rd channel ENV3/OSC3 value as control)
    if (memory[1] & 3) memory[SIDaddr + 0x1b] = wfout >> 8;
    memory[SIDaddr + 0x1c] = envcnt[3];
    //OSC3, ENV3 (some players rely on it)

    //FILTER: two integrator loop bi-quadratic filter, workings learned from resid code, but I kindof simplified the equations
    //The phases of lowpass and highpass outputs are inverted compared to the input, but bandpass IS in phase with the input signal.
    //The 8580 cutoff frequency control-curve is ideal, while the 6581 has a treshold, and below it it outputs a constant lowpass frequency.
    cutoff = (memory[SIDaddr + 0x15] & 7) / 8 + memory[SIDaddr + 0x16] + 0.2;
    if (SID_model[num] === 8580) {
      cutoff = 1 - Math.exp(cutoff * cutoff_ratio_8580);
      resonance = 2 ** ((4 - (memory[SIDaddr + 0x17] >> 4)) / 8);
    } else {
      if (cutoff < 24) cutoff = 0.035;
      else cutoff = 1 - 1.263 * Math.exp(cutoff * cutoff_ratio_6581);
      resonance = memory[SIDaddr + 0x17] > 0x5f ? 8 / (memory[SIDaddr + 0x17] >> 4) : 1.41;
    }
    tmp = filtin + prevbandpass[num] * resonance + prevlowpass[num];
    if (memory[SIDaddr + 0x18] & HIGHPASS_BITMASK) output -= tmp;
    tmp = prevbandpass[num] - tmp * cutoff;
    prevbandpass[num] = tmp;
    if (memory[SIDaddr + 0x18] & BANDPASS_BITMASK) output -= tmp;
    tmp = prevlowpass[num] + tmp * cutoff;
    prevlowpass[num] = tmp;
    if (memory[SIDaddr + 0x18] & LOWPASS_BITMASK) output += tmp;

    //when it comes to $D418 volume-register digi playback, I made an AC / DC separation for $D418 value in the SwinSID at low (20Hz or so) cutoff-frequency,
    //and sent the AC (highpass) value to a 4th 'digi' channel mixed to the master output, and set ONLY the DC (lowpass) value to the volume-control.
    //This solved 2 issues: Thanks to the lowpass filtering of the volume-control, SID tunes where digi is played together with normal SID channels,
    //won't sound distorted anymore, and the volume-clicks disappear when setting SID-volume. (This is useful for fade-in/out tunes like Hades Nebula, where clicking ruins the intro.)
    return (output / OUTPUT_SCALEDOWN) * (memory[SIDaddr + 0x18] & 0xf);
    // SID output
  }

  //And now, the combined waveforms. The resid source simply uses 4kbyte 8bit samples from wavetable arrays, says these waveforms are mystic due to the analog behaviour.
  //It's true, the analog things inside SID play a significant role in how the combined waveforms look like, but process variations are not so huge that cause much differences in SIDs.
  //After checking these waveforms by eyes, it turned out for me that these waveform are fractal-like, recursively approachable waveforms.
  //My 1st thought and trial was to store only a portion of the waveforms in table, and magnify them depending on phase-accumulator's state.
  //But I wanted to understand how these waveforms are produced. I felt from the waveform-diagrams that the bits of the waveforms affect each other,
  //hence the recursive look. A short C code proved by assumption, I could generate something like a pulse+saw combined waveform.
  //Recursive calculations were not feasible for MCU of SwinSID, but for jsSID I could utilize what I found out and code below generates the combined waveforms into wavetables.
  //To approach the combined waveforms as much as possible, I checked out the SID schematic that can be found at some reverse-engineering sites...
  //The SID's R-2R ladder WAVE DAC is driven by operation-amplifier like complementary FET output drivers, so that's not the place where I first thought the magic happens.
  //These 'opamps' (for all 12 wave-bits) have single FETs as inputs, and they switch on above a certain level of input-voltage, causing 0 or 1 bit as R-2R DAC input.
  //So the first keyword for the workings is TRESHOLD. These FET inputs are driven through serial switch FETs (wave-selector) that normally enables one waveform at a time.
  //The phase-accumulator's output is brought to 3 kinds of circuitries for the 3 basic waveforms. The pulse simply drives
  //all wave-selector inputs with a 0/1 depending on pulsewidth, the sawtooth has a XOR for triangle/ringmod generation, but what
  //is common for all waveforms, they have an open-drain driver before the wave-selector, which has FETs towards GND and 'FET resistor' towards the power-supply rail.
  //These outputs are clearly not designed to drive high loads, and normally they only have to drive the FETs input mentioned above.
  //But when more of these output drivers are switched together by the switch-FETs in the wave-selector, they affect each other by loading each other.
  //The pulse waveform, when selected, connects all of them together through a fairly strong connection, and its signal also affects the analog level (pulls below the treshold)...
  //The farther a specific DAC bit driver is from the other, the less it affects its output. It turned out it's not powers of 2 but something else,
  //that creates similar combined waveforms to that of real SID's...
  //The analog levels that get generated by the various bit drivers, that pull each other up/down depends on the resistances the components inside the SID have.
  //And finally, what is output on the DAC depends on whether these analog levels are below or above the FET gate's treshold-level,
  //That's how the combined waveform is generated. Maybe I couldn't explain well enough, but the code below is simple enough to understand the mechanism algoritmically.
  //This simplified schematic exapmle might make it easier to understand sawtooth+pulse combination (must be observed with monospace fonts):
  //                               _____            |-    .--------------.   /\/\--.
  // Vsupply                /  .----| |---------*---|-    /    Vsupply   !    R    !      As can be seen on this schematic,
  //  ------.       other   !  !   _____        !  TRES   \       \      !         /      the pulse wave-selector FETs
  //        !       saw bit *--!----| |---------'  HOLD   /       !     |-     2R  \      connect the neighbouring sawtooth
  //        /       output  !  !                          !      |------|-         /      outputs with a fairly strong
  //     Rd \              |-  !WAVEFORM-SELECTOR         *--*---|-      !    R    !      connection to each other through
  //        /              |-  !SWITCHING FETs            !  !    !      *---/\/\--*      their own wave-selector FETs.
  //        ! saw-bit          !    _____                |-  !   ---     !         !      So the adjacent sawtooth outputs
  //        *------------------!-----| |-----------*-----|-  !          |-         /      pull each other upper/lower
  //        ! (weak drive,so   !  saw switch       ! TRES-!  `----------|-     2R  \      depending on their low/high state and
  //       |- can be shifted   !                   ! HOLD !              !         /      distance from each other, causing
  //  -----|- by neighbours    !    _____          !      !              !     R   !      the resulting analog level that
  //        ! up or down)      *-----| |-----------'     ---            ---   /\/\-*      will either turn the output on or not.
  //   GND ---                 !  pulse switch                                     !      (Depending on their relation to treshold.)
  //
  //(As triangle waveform connects adjacent bits by default, the above explained effect becomes even stronger, that's why combined waveforms with thriangle are at 0 level most of the time.)

  function combinedWaveForm(
    num: number,
    channel: number,
    waveform: number[],
    index: number,
    differ6581: 0 | 1,
  ) {
    //on 6581 most combined waveforms are essentially halved 8580-like waves
    if (differ6581 && SID_model[num] === 6581) index &= 0x7ff;
    combiwf = (waveform[index] + prevwavdata[channel]) / 2;
    prevwavdata[channel] = waveform[index];
    return combiwf;
  }

  //volume range: 0..1
  function getOutput() {
    return (output / OUTPUT_SCALEDOWN) * (memory[0xd418] & 0xf);
  }

  function whittakerPlayerWorkaround(addr: number) {
    if (addr === 0xd404 && !(memory[0xd404] & 1)) ADSRstate[0] &= 0x3e;
    if (addr === 0xd40b && !(memory[0xd40b] & 1)) ADSRstate[1] &= 0x3e;
    if (addr === 0xd412 && !(memory[0xd412] & 1)) ADSRstate[2] &= 0x3e;
  }

  return { init, emulate, whittakerPlayerWorkaround, getOutput };
}

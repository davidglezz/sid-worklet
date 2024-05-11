const SID_CHANNEL_AMOUNT = 3;
const OUTPUT_SCALEDOWN = 0x10000 * SID_CHANNEL_AMOUNT * 16;

const enum Bitmask {
  GATE = 0x01,
  SYNC = 0x02,
  RING = 0x04,
  TEST = 0x08,
  TRI = 0x10,
  SAW = 0x20,
  PULSE = 0x40,
  NOISE = 0x80,
  HOLDZERO = 0x10,
  DECAYSUSTAIN = 0x40,
  ATTACK = 0x80,
  LOWPASS = 0x10,
  BANDPASS = 0x20,
  HIGHPASS = 0x40,
  OFF3 = 0x80,
}

// ADSR constants
const ADSRperiods = [
  0, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251,
];
const ADSRstep = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

// Prescaler values that slow down the envelope-counter as it decays and approaches zero level
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
  // Neighboring bits affect each other recursively
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
  const FILTSW = [1, 2, 4, 1, 2, 4, 1, 2, 4] as const;
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
  const prevlowpass = [0, 0, 0];
  const prevbandpass = [0, 0, 0];
  const cutoff_ratio_8580 = (-2 * 3.14 * (12500 / 256)) / samplerate;
  const cutoff_ratio_6581 = (-2 * 3.14 * (20000 / 256)) / samplerate;
  let wfout: number;
  let cutoff: number;
  let resonance: number;
  let filtin: number;
  let output: number;

  function init() {
    for (let i = 0xd400; i <= 0xd7ff; i++) memory[i] = 0;
    for (let i = 0xde00; i <= 0xdfff; i++) memory[i] = 0;
    for (let i = 0; i < 9; i++) {
      ADSRstate[i] = Bitmask.HOLDZERO;
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
      const prevgate = ADSRstate[channel] & Bitmask.GATE;
      const chnadd = SIDaddr + (channel - num * SID_CHANNEL_AMOUNT) * 7;
      const ctrl = memory[chnadd + 4];
      const wf = ctrl & 0xf0;
      const test = ctrl & Bitmask.TEST;
      const SR = memory[chnadd + 6];

      //ADSR envelope generator:
      let crispStart = 0;
      if (prevgate !== (ctrl & Bitmask.GATE)) {
        //gatebit-change?
        if (prevgate) {
          ADSRstate[channel] &= 0xff - (Bitmask.GATE | Bitmask.ATTACK | Bitmask.DECAYSUSTAIN);
        } //falling edge (with Whittaker workaround this never happens, but should be here)
        else {
          ADSRstate[channel] = Bitmask.GATE | Bitmask.ATTACK | Bitmask.DECAYSUSTAIN;
          //rising edge, also sets hold_zero_bit=0
          if ((SR & 0xf) > (prevSR[channel] & 0xf)) crispStart = 1;
          //assume SR->GATE write order: workaround to have crisp soundstarts by triggering delay-bug
        }
        //(this is for the possible missed CTRL(GATE) vs SR register write order situations (1MHz CPU is cca 20 times faster than samplerate)
      }
      prevSR[channel] = SR;

      ratecnt[channel] += clk_ratio;
      if (ratecnt[channel] >= 0x8000) ratecnt[channel] -= 0x8000;
      //can wrap around (ADSR delay-bug: short 1st frame is usually achieved by utilizing this bug)

      //set ADSR period that should be checked against rate-counter (depending on ADSR state Attack/DecaySustain/Release)
      const periodStep =
        ADSRstate[channel] & Bitmask.ATTACK ? memory[chnadd + 5] >> 4
        : ADSRstate[channel] & Bitmask.DECAYSUSTAIN ? memory[chnadd + 5] & 0xf
        : SR & 0xf;
      const period = ADSRperiods[periodStep];
      const step = ADSRstep[periodStep];

      if (ratecnt[channel] >= period && ratecnt[channel] < period + clk_ratio && crispStart === 0) {
        //ratecounter shot (matches rateperiod) (in genuine SID ratecounter is LFSR)
        ratecnt[channel] -= period;
        //compensation for timing instead of simply setting 0 on rate-counter overload
        if (
          ADSRstate[channel] & Bitmask.ATTACK ||
          ++expcnt[channel] === ADSR_exptable[envcnt[channel]]
        ) {
          if (!(ADSRstate[channel] & Bitmask.HOLDZERO)) {
            if (ADSRstate[channel] & Bitmask.ATTACK) {
              envcnt[channel] += step;
              if (envcnt[channel] >= 0xff) {
                envcnt[channel] = 0xff;
                ADSRstate[channel] &= 0xff - Bitmask.ATTACK;
              }
            } else if (
              !(ADSRstate[channel] & Bitmask.DECAYSUSTAIN) ||
              envcnt[channel] > (SR >> 4) + (SR & 0xf0)
            ) {
              envcnt[channel] -= step;
              if (envcnt[channel] <= 0 && envcnt[channel] + step !== 0) {
                envcnt[channel] = 0;
                ADSRstate[channel] |= Bitmask.HOLDZERO;
              }
            }
          }
          expcnt[channel] = 0;
        }
      }

      envcnt[channel] &= 0xff;
      //'envcnt' may wrap around in some cases, mostly 0 -> FF (e.g.: Cloudless Rain, Boombox Alley)

      //WAVE generation codes (phase accumulator and waveform-selector):  (They are explained in resid source, I won't go in details, the code speaks for itself.)
      const accuadd = (memory[chnadd] + memory[chnadd + 1] * 256) * clk_ratio;
      if (test || (ctrl & Bitmask.SYNC && sourceMSBrise[num])) {
        phaseaccu[channel] = 0;
      } else {
        phaseaccu[channel] += accuadd;
        if (phaseaccu[channel] > 0xffffff) phaseaccu[channel] -= 0x1000000;
      }
      const MSB = phaseaccu[channel] & 0x800000;
      sourceMSBrise[num] = MSB > (prevaccu[channel] & 0x800000) ? 1 : 0;
      //phaseaccu[channel] &= 0xFFFFFF;

      //waveform-selector:
      if (wf & Bitmask.NOISE) {
        //noise waveform
        let noiseLFSR = noise_LFSR[channel];
        if (
          (phaseaccu[channel] & 0x100000) !== (prevaccu[channel] & 0x100000) ||
          accuadd >= 0x100000
        ) {
          //clock LFSR all time if clockrate exceeds observable at given samplerate
          const step = (noiseLFSR & 0x400000) ^ ((noiseLFSR & 0x20000) << 5);
          noiseLFSR = ((noiseLFSR << 1) + +(step > 0 || test)) & 0x7fffff;
          noise_LFSR[channel] = noiseLFSR;
        }
        //we simply zero output when other waveform is mixed with noise. On real SID LFSR continuously gets filled by zero and locks up. ($C1 waveform with pw<8 can keep it for a while...)
        wfout =
          wf & 0x70 ? 0 : (
            ((noiseLFSR & 0x100000) >> 5) +
            ((noiseLFSR & 0x40000) >> 4) +
            ((noiseLFSR & 0x4000) >> 1) +
            ((noiseLFSR & 0x800) << 1) +
            ((noiseLFSR & 0x200) << 2) +
            ((noiseLFSR & 0x20) << 5) +
            ((noiseLFSR & 0x04) << 7) +
            ((noiseLFSR & 0x01) << 8)
          );
      } else if (wf & Bitmask.PULSE) {
        //simple pulse
        let pw = (memory[chnadd + 2] + (memory[chnadd + 3] & 0xf) * 256) * 16;
        const pwMin = accuadd >> 9;
        if (pw > 0 && pw < pwMin) pw = pwMin;
        const pwMax = pwMin ^ 0xffff;
        if (pw > pwMax) pw = pwMax;

        const phase = phaseaccu[channel] >> 8;
        if (wf === Bitmask.PULSE) {
          const step = 256 / (accuadd >> 16);
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
          if (test) {
            wfout = 0xffff;
          } else if (phase < pw) {
            //rising edge
            let limit = (0xffff - pw) * step;
            if (limit > 0xffff) limit = 0xffff;
            wfout = limit - (pw - phase) * step;
            if (wfout < 0) wfout = 0;
          } else {
            //falling edge
            let limit = pw * step;
            if (limit > 0xffff) limit = 0xffff;
            wfout = (0xffff - phase) * step - limit;
            if (wfout >= 0) wfout = 0xffff;
            wfout &= 0xffff;
          }
        } else if (phase >= pw || test) {
          //combined pulse
          //(this would be enough for simple but aliased-at-high-pitches pulse)
          wfout = 0xffff;

          // pulse+triangle
          if (wf & Bitmask.TRI) {
            // pulse+triangle+saw (waveform nearly identical to tri+saw)
            if (wf & Bitmask.SAW) {
              wfout = combinedWaveForm(num, channel, PulseTriSaw_8580, phase >> 4, 1);
            } else {
              const value = phaseaccu[channel] ^ (ctrl & Bitmask.RING ? sourceMSB[num] : 0);
              wfout = combinedWaveForm(
                num,
                channel,
                PulseSaw_8580,
                (value ^ (value & 0x800000 ? 0xffffff : 0)) >> 11,
                0,
              );
            }
          } else if (wf & Bitmask.SAW) {
            //pulse+saw
            wfout = combinedWaveForm(num, channel, PulseSaw_8580, phase >> 4, 1);
          }
        } else {
          wfout = 0;
        }
      } else if (wf & Bitmask.SAW) {
        //saw
        wfout = phaseaccu[channel] >> 8;
        //saw (this row would be enough for simple but aliased-at-high-pitch saw)
        //The anti-aliasing (cleaning) of high-pitched sawtooth wave works by the same principle as mentioned above for the pulse,
        //but the sawtooth has even harsher edge/transition, and as the falling edge gets longer, tha rising edge should became shorter,
        //and to keep the amplitude, it should be multiplied a little bit (with reciprocal of rising-edge steepness).
        //The waveform at the output essentially becomes an asymmetric triangle, more-and-more approaching symmetric shape towards high frequencies.
        //(If you check a recording from the real SID, you can see a similar shape, the high-pitch sawtooth waves are triangle-like...)
        //But for deep sounds the sawtooth is really close to a sawtooth, as there is no aliasing there, but deep sounds should be sharp...
        if (wf & Bitmask.TRI) {
          //saw+triangle
          wfout = combinedWaveForm(num, channel, TriSaw_8580, wfout >> 4, 1);
        } else {
          //simple cleaned (bandlimited) saw
          const step = accuadd / 0x1200000;
          wfout += wfout * step;
          if (wfout > 0xffff) {
            wfout = 0xffff - (wfout - 0x10000) / step;
          }
        }
      } else if (wf & Bitmask.TRI) {
        //triangle (this waveform has no harsh edges, so it doesn't suffer from strong aliasing at high pitches)
        const value = phaseaccu[channel] ^ (ctrl & Bitmask.RING ? sourceMSB[num] : 0);
        wfout = (value ^ (value & 0x800000 ? 0xffffff : 0)) >> 7;
      }

      prevwfout[channel] = wfout = wf ? wfout : prevwfout[channel];

      //emulate waveform 00 floating wave-DAC (on real SID waveform00 decays after 15s..50s depending on temperature?)
      prevaccu[channel] = phaseaccu[channel];
      sourceMSB[num] = MSB;
      //(So the decay is not an exact value. Anyway, we just simply keep the value to avoid clicks and support SounDemon digi later...)

      //routing the channel signal to either the filter or the unfiltered master output depending on filter-switch SID-registers
      if (memory[SIDaddr + 0x17] & FILTSW[channel]) {
        filtin += (wfout - 0x8000) * (envcnt[channel] / 256);
      } else if (channel % SID_CHANNEL_AMOUNT !== 2 || !(memory[SIDaddr + 0x18] & Bitmask.OFF3)) {
        output += (wfout - 0x8000) * (envcnt[channel] / 256);
      }
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
      cutoff = cutoff < 24 ? 0.035 : 1 - 1.263 * Math.exp(cutoff * cutoff_ratio_6581);
      resonance = memory[SIDaddr + 0x17] > 0x5f ? 8 / (memory[SIDaddr + 0x17] >> 4) : 1.41;
    }
    let filterValue = filtin + prevbandpass[num] * resonance + prevlowpass[num];
    if (memory[SIDaddr + 0x18] & Bitmask.HIGHPASS) output -= filterValue;
    filterValue = prevbandpass[num] - filterValue * cutoff;
    prevbandpass[num] = filterValue;
    if (memory[SIDaddr + 0x18] & Bitmask.BANDPASS) output -= filterValue;
    filterValue = prevlowpass[num] + filterValue * cutoff;
    prevlowpass[num] = filterValue;
    if (memory[SIDaddr + 0x18] & Bitmask.LOWPASS) output += filterValue;

    //when it comes to $D418 volume-register digi playback, I made an AC / DC separation for $D418 value in the SwinSID at low (20Hz or so) cutoff-frequency,
    //and sent the AC (highpass) value to a 4th 'digi' channel mixed to the master output, and set ONLY the DC (lowpass) value to the volume-control.
    //This solved 2 issues: Thanks to the lowpass filtering of the volume-control, SID tunes where digi is played together with normal SID channels,
    //won't sound distorted anymore, and the volume-clicks disappear when setting SID-volume. (This is useful for fade-in/out tunes like Hades Nebula, where clicking ruins the intro.)
    return (output / OUTPUT_SCALEDOWN) * (memory[SIDaddr + 0x18] & 0xf);
    // SID output
  }

  function combinedWaveForm(
    num: number,
    channel: number,
    waveform: number[],
    index: number,
    differ6581: 0 | 1,
  ) {
    //on 6581 most combined waveforms are essentially halved 8580-like waves
    if (differ6581 && SID_model[num] === 6581) index &= 0x7ff;
    const combiwf = (waveform[index] + prevwavdata[channel]) / 2;
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

//My CPU implementation is based on the instruction table by Graham at codebase64.
//After some examination of the table it was clearly seen that columns of the table (instructions' 2nd nybbles)
// mainly correspond to addressing modes, and double-rows usually have the same instructions.
//The code below is laid out like this, with some exceptions present.
//Thanks to the hardware being in my mind when coding this, more of the illegal instructions can be added fairly easily...
export function createCPU(memory: Uint8Array) {
  //CPU (and CIA/VIC-IRQ) emulation constants and variables - avoiding internal/automatic variables to retain speed
  const flagsw = [0x01, 0x21, 0x04, 0x24, 0x00, 0x40, 0x08, 0x28];
  const branchflag = [0x80, 0x40, 0x01, 0x02];
  let PC = 0;
  let A = 0;
  let T = 0;
  let X = 0;
  let Y = 0;
  let SP = 0xff;
  let IR = 0;
  let addr = 0;
  let ST = 0x00;
  let cycles = 0;
  let storadd = 0;
  //STATUS-flags: N V - B D I Z C

  function init(mempos: number, AValue = 0) {
    PC = mempos;
    A = AValue;
    X = 0;
    Y = 0;
    ST = 0;
    SP = 0xff;
  }

  //the CPU emulation for SID/PRG playback (ToDo: CIA/VIC-IRQ/NMI/RESET vectors, BCD-mode)
  //'IR' is the instruction-register, naming after the hardware-equivalent
  function tick() {
    IR = memory[PC];
    cycles = 2;
    storadd = 0;
    //'cycle': ensure smallest 6510 runtime (for implied/register instructions)

    if (IR & 1) {
      //nybble2:  1/5/9/D:accu.instructions, 3/7/B/F:illegal opcodes
      switch (IR & 0x1f) {
        //addressing modes (begin with more complex cases), PC wraparound not handled inside to save codespace
        case 1:
        case 3:
          addr = memory[memory[++PC] + X] + memory[memory[PC] + X + 1] * 256;
          cycles = 6;
          break;
        //(zp,x)
        case 0x11:
        case 0x13:
          addr = memory[memory[++PC]] + memory[memory[PC] + 1] * 256 + Y;
          cycles = 6;
          break;
        //(zp),y
        case 0x19:
        case 0x1f:
          addr = memory[++PC] + memory[++PC] * 256 + Y;
          cycles = 5;
          break;
        //abs,y
        case 0x1d:
          addr = memory[++PC] + memory[++PC] * 256 + X;
          cycles = 5;
          break;
        //abs,x
        case 0xd:
        case 0xf:
          addr = memory[++PC] + memory[++PC] * 256;
          cycles = 4;
          break;
        //abs
        case 0x15:
          addr = memory[++PC] + X;
          cycles = 4;
          break;
        //zp,x
        case 5:
        case 7:
          addr = memory[++PC];
          cycles = 3;
          break;
        //zp
        case 0x17:
          addr = memory[++PC] + Y;
          cycles = 4;
          break;
        //zp,y for LAX/SAX illegal opcodes
        case 9:
        case 0xb:
          addr = ++PC;
          cycles = 2;
        //immediate
      }
      addr &= 0xffff;
      switch (IR & 0xe0) {
        case 0x60:
          T = A;
          A += memory[addr] + (ST & 1);
          ST &= 20;
          ST |= (A & 128) | (A > 255);
          A &= 0xff;
          ST |= (!A << 1) | ((!((T ^ memory[addr]) & 0x80) && (T ^ A) & 0x80) >> 1);
          break;
        //ADC
        case 0xe0:
          T = A;
          A -= memory[addr] + !(ST & 1);
          ST &= 20;
          ST |= (A & 128) | (A >= 0);
          A &= 0xff;
          ST |= (!A << 1) | (((T ^ memory[addr]) & 0x80 && (T ^ A) & 0x80) >> 1);
          break;
        //SBC
        case 0xc0:
          T = A - memory[addr];
          ST &= 124;
          ST |= (!(T & 0xff) << 1) | (T & 128) | (T >= 0);
          break;
        //CMP
        case 0x00:
          A |= memory[addr];
          ST &= 125;
          ST |= (!A << 1) | (A & 128);
          break;
        //ORA
        case 0x20:
          A &= memory[addr];
          ST &= 125;
          ST |= (!A << 1) | (A & 128);
          break;
        //AND
        case 0x40:
          A ^= memory[addr];
          ST &= 125;
          ST |= (!A << 1) | (A & 128);
          break;
        //EOR
        case 0xa0:
          A = memory[addr];
          ST &= 125;
          ST |= (!A << 1) | (A & 128);
          if ((IR & 3) === 3) X = A;
          break;
        //LDA / LAX (illegal, used by my 1 rasterline player)
        case 0x80:
          memory[addr] = A & ((IR & 3) === 3 ? X : 0xff);
          storadd = addr;
        //STA / SAX (illegal)
      }
    } else if (IR & 2) {
      //nybble2:  2:illegal/LDX, 6:A/X/INC/DEC, A:Accu-shift/reg.transfer/NOP, E:shift/X/INC/DEC
      switch (IR & 0x1f) {
        //addressing modes
        case 0x1e: //abs,x / abs,y
          addr = memory[++PC] + memory[++PC] * 256 + ((IR & 0xc0) !== 0x80 ? X : Y);
          cycles = 5;
          break;
        case 0xe: //abs
          addr = memory[++PC] + memory[++PC] * 256;
          cycles = 4;
          break;
        case 0x16: //zp,x / zp,y
          addr = memory[++PC] + ((IR & 0xc0) !== 0x80 ? X : Y);
          cycles = 4;
          break;
        case 6: //zp
          addr = memory[++PC];
          cycles = 3;
          break;
        case 2: //imm.
          addr = ++PC;
          cycles = 2;
      }
      addr &= 0xffff;
      switch (IR & 0xe0) {
        case 0x00:
          ST &= 0xfe;
        // eslint-disable-next-line no-fallthrough
        case 0x20:
          if ((IR & 0xf) === 0xa) {
            //ASL/ROL (Accu)
            A = (A << 1) + (ST & 1);
            ST &= 60;
            ST |= (A & 128) | (A > 255);
            A &= 0xff;
            ST |= !A << 1;
          } else {
            //RMW (Read-Write-Modify)
            T = (memory[addr] << 1) + (ST & 1);
            ST &= 60;
            ST |= (T & 128) | (T > 255);
            T &= 0xff;
            ST |= !T << 1;
            memory[addr] = T;
            cycles += 2;
          }
          break;
        case 0x40:
          ST &= 0xfe;
        // eslint-disable-next-line no-fallthrough
        case 0x60:
          if ((IR & 0xf) === 0xa) {
            //LSR/ROR (Accu)
            T = A;
            A = (A >> 1) + (ST & 1) * 128;
            ST &= 60;
            ST |= (A & 128) | (T & 1);
            A &= 0xff;
            ST |= !A << 1;
          } else {
            T = (memory[addr] >> 1) + (ST & 1) * 128;
            ST &= 60;
            ST |= (T & 128) | (memory[addr] & 1);
            T &= 0xff;
            ST |= !T << 1;
            memory[addr] = T;
            cycles += 2;
          }
          break;
        //RMW
        case 0xc0:
          if (IR & 4) {
            memory[addr]--;
            memory[addr] &= 0xff;
            ST &= 125;
            ST |= (!memory[addr] << 1) | (memory[addr] & 128);
            cycles += 2;
          } //DEC
          else {
            X--;
            X &= 0xff;
            ST &= 125;
            ST |= (!X << 1) | (X & 128);
          }
          break;
        //DEX
        case 0xa0:
          if ((IR & 0xf) !== 0xa) X = memory[addr];
          else if (IR & 0x10) {
            X = SP;
            break;
          } else X = A;
          ST &= 125;
          ST |= (!X << 1) | (X & 128);
          break;
        //LDX/TSX/TAX
        case 0x80:
          if (IR & 4) {
            memory[addr] = X;
            storadd = addr;
          } else if (IR & 0x10) SP = X;
          else {
            A = X;
            ST &= 125;
            ST |= (!A << 1) | (A & 128);
          }
          break;
        //STX/TXS/TXA
        case 0xe0:
          if (IR & 4) {
            memory[addr]++;
            memory[addr] &= 0xff;
            ST &= 125;
            ST |= (!memory[addr] << 1) | (memory[addr] & 128);
            cycles += 2;
          }
        //INC/NOP
      }
    } else if ((IR & 0xc) === 8) {
      //nybble2:  8:register/status
      switch (IR & 0xf0) {
        case 0x60:
          SP++;
          SP &= 0xff;
          A = memory[0x100 + SP];
          ST &= 125;
          ST |= (!A << 1) | (A & 128);
          cycles = 4;
          break;
        //PLA
        case 0xc0:
          Y++;
          Y &= 0xff;
          ST &= 125;
          ST |= (!Y << 1) | (Y & 128);
          break;
        //INY
        case 0xe0:
          X++;
          X &= 0xff;
          ST &= 125;
          ST |= (!X << 1) | (X & 128);
          break;
        //INX
        case 0x80:
          Y--;
          Y &= 0xff;
          ST &= 125;
          ST |= (!Y << 1) | (Y & 128);
          break;
        //DEY
        case 0x00:
          memory[0x100 + SP] = ST;
          SP--;
          SP &= 0xff;
          cycles = 3;
          break;
        //PHP
        case 0x20:
          SP++;
          SP &= 0xff;
          ST = memory[0x100 + SP];
          cycles = 4;
          break;
        //PLP
        case 0x40:
          memory[0x100 + SP] = A;
          SP--;
          SP &= 0xff;
          cycles = 3;
          break;
        //PHA
        case 0x90:
          A = Y;
          ST &= 125;
          ST |= (!A << 1) | (A & 128);
          break;
        //TYA
        case 0xa0:
          Y = A;
          ST &= 125;
          ST |= (!Y << 1) | (Y & 128);
          break;
        //TAY
        default:
          if (flagsw[IR >> 5] & 0x20) ST |= flagsw[IR >> 5] & 0xdf;
          else ST &= 255 - (flagsw[IR >> 5] & 0xdf);
        //CLC/SEC/CLI/SEI/CLV/CLD/SED
      }
    } else {
      //nybble2:  0: control/branch/Y/compare  4: Y/compare  C:Y/compare/JMP
      if ((IR & 0x1f) === 0x10) {
        PC++;
        T = memory[PC];
        if (T & 0x80) T -= 0x100;
        //BPL/BMI/BVC/BVS/BCC/BCS/BNE/BEQ  relative branch
        if (IR & 0x20) {
          if (ST & branchflag[IR >> 6]) {
            PC += T;
            cycles = 3;
          }
        } else {
          if (!(ST & branchflag[IR >> 6])) {
            PC += T;
            cycles = 3;
          }
        }
      } else {
        //nybble2:  0:Y/control/Y/compare  4:Y/compare  C:Y/compare/JMP
        //addressing modes
        switch (IR & 0x1f) {
          case 0: //imm. (or abs.low for JSR/BRK)
            addr = ++PC;
            cycles = 2;
            break;
          case 0x1c: //abs,x
            addr = memory[++PC] + memory[++PC] * 256 + X;
            cycles = 5;
            break;
          case 0xc: //abs
            addr = memory[++PC] + memory[++PC] * 256;
            cycles = 4;
            break;
          case 0x14: //zp,x
            addr = memory[++PC] + X;
            cycles = 4;
            break;
          case 4: //zp
            addr = memory[++PC];
            cycles = 3;
        }
        addr &= 0xffff;
        switch (IR & 0xe0) {
          case 0x00: //BRK
            memory[0x100 + SP] = PC % 256;
            SP--;
            SP &= 0xff;
            memory[0x100 + SP] = PC / 256;
            SP--;
            SP &= 0xff;
            memory[0x100 + SP] = ST;
            SP--;
            SP &= 0xff;
            PC = memory[0xfffe] + memory[0xffff] * 256 - 1;
            cycles = 7;
            break;
          case 0x20:
            if (IR & 0xf) {
              //BIT
              ST &= 0x3d;
              ST |= (memory[addr] & 0xc0) | (!(A & memory[addr]) << 1);
            } else {
              //JSR
              memory[0x100 + SP] = (PC + 2) % 256;
              SP--;
              SP &= 0xff;
              memory[0x100 + SP] = (PC + 2) / 256;
              SP--;
              SP &= 0xff;
              PC = memory[addr] + memory[addr + 1] * 256 - 1;
              cycles = 6;
            }
            break;
          case 0x40:
            if (IR & 0xf) {
              //JMP
              PC = addr - 1;
              cycles = 3;
            } else {
              //RTI
              if (SP >= 0xff) return 0xfe;
              SP++;
              SP &= 0xff;
              ST = memory[0x100 + SP];
              SP++;
              SP &= 0xff;
              T = memory[0x100 + SP];
              SP++;
              SP &= 0xff;
              PC = memory[0x100 + SP] + T * 256 - 1;
              cycles = 6;
            }
            break;
          case 0x60:
            if (IR & 0xf) {
              //JMP() (indirect)
              PC = memory[addr] + memory[addr + 1] * 256 - 1;
              cycles = 5;
            } else {
              //RTS
              if (SP >= 0xff) return 0xff;
              SP++;
              SP &= 0xff;
              T = memory[0x100 + SP];
              SP++;
              SP &= 0xff;
              PC = memory[0x100 + SP] + T * 256 - 1;
              cycles = 6;
            }
            break;
          case 0xc0: //CPY
            T = Y - memory[addr];
            ST &= 124;
            ST |= (!(T & 0xff) << 1) | (T & 128) | (T >= 0);
            break;
          case 0xe0: //CPX
            T = X - memory[addr];
            ST &= 124;
            ST |= (!(T & 0xff) << 1) | (T & 128) | (T >= 0);
            break;
          case 0xa0: //LDY
            Y = memory[addr];
            ST &= 125;
            ST |= (!Y << 1) | (Y & 128);
            break;
          case 0x80: //STY
            memory[addr] = Y;
            storadd = addr;
        }
      }
    }

    PC++;
    PC &= 0xffff;
    return 0;
    //memory[addr]&=0xFF;
  }

  function galwayRubiconWorkaround(SID_address1: number, SID_address2: number) {
    //CJ in the USA workaround (writing above $d420, except SID2/SID3)
    if (storadd >= 0xd420 && storadd < 0xd800 && memory[1] & 3) {
      if (
        !(SID_address1 <= storadd && storadd < SID_address1 + 0x1f) &&
        !(SID_address2 <= storadd && storadd < SID_address2 + 0x1f)
      )
        memory[storadd & 0xd41f] = memory[storadd];
    }
  }

  return {
    tick,
    init,
    get cycles() {
      return cycles;
    },
    get storadd() {
      return storadd;
    },
    get addr() {
      return addr;
    },
    get PC() {
      return PC;
    },
    set PC(value: number) {
      PC = value;
    },
    get SP() {
      return SP;
    },
    set SP(value: number) {
      SP = value;
    },
    galwayRubiconWorkaround,
  };
}

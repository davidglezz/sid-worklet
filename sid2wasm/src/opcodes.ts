/**
 * Minimal 6502 instruction decoder.
 *
 * The generated WASM deliberately mirrors the instruction dispatch used by
 * `src/cpu.ts` (which is itself derived from jsSID). That keeps playback
 * behaviour identical to the existing TypeScript player, including its
 * quirks and illegal-opcode handling.
 */

/** Number of bytes consumed by an instruction (including the opcode). */
export function instructionLength(opcode: number): number {
  if (opcode & 1) {
    switch (opcode & 0x1f) {
      case 0x01:
      case 0x03:
      case 0x11:
      case 0x13:
      case 0x15:
      case 0x17:
      case 0x05:
      case 0x07:
      case 0x09:
      case 0x0b:
        return 2;
      case 0x19:
      case 0x1f:
      case 0x1d:
      case 0x0d:
      case 0x0f:
        return 3;
      default:
        return 1;
    }
  }

  if (opcode & 2) {
    switch (opcode & 0x1f) {
      case 0x1e:
      case 0x0e:
        return 3;
      case 0x16:
      case 0x06:
      case 0x02:
        return 2;
      default:
        return 1;
    }
  }

  if ((opcode & 0x0c) === 0x08) {
    return 1;
  }

  if ((opcode & 0x1f) === 0x10) {
    return 2;
  }

  switch (opcode & 0x1f) {
    case 0x00:
      // JSR is the only three-byte instruction with addressing-mode 0.
      return opcode === 0x20 ? 3 : 2;
    case 0x1c:
    case 0x0c:
      return 3;
    case 0x14:
    case 0x04:
      return 2;
    default:
      return 1;
  }
}

/** Relative-branch condition flags indexed by `opcode >> 6`. */
export const BRANCH_FLAGS = [0x80, 0x40, 0x01, 0x02] as const;

/** Flag operation table used by CLC/SEC/CLI/SEI/CLV/CLD/SED. */
export const FLAG_OPERATIONS = [0x01, 0x21, 0x04, 0x24, 0x00, 0x40, 0x08, 0x28] as const;

export function isBranch(opcode: number): boolean {
  return (
    (opcode & 1) === 0 && (opcode & 2) === 0 && (opcode & 0x0c) !== 0x08 && (opcode & 0x1f) === 0x10
  );
}

export function isAluGroup(opcode: number): boolean {
  return (opcode & 1) !== 0;
}

export function isShiftGroup(opcode: number): boolean {
  return (opcode & 1) === 0 && (opcode & 2) !== 0;
}

export function isStackGroup(opcode: number): boolean {
  return (opcode & 1) === 0 && (opcode & 2) === 0 && (opcode & 0x0c) === 0x08;
}

export function isControlGroup(opcode: number): boolean {
  return !isAluGroup(opcode) && !isShiftGroup(opcode) && !isStackGroup(opcode);
}

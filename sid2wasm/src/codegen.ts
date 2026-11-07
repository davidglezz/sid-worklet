/**
 * 6502 → WebAssembly text (WAT) code generator.
 *
 * Every byte of the loaded C64 image gets its own WASM function. The function
 * executes exactly one 6502 instruction and jumps to the next one by updating
 * the `$pc` global. Before executing, it checks that the instruction bytes in
 * memory still match the bytes it was compiled from; if they do not (e.g. a
 * self-modifying player), it delegates to a generic interpreter.
 *
 * The generated module exposes:
 *   - memory           : the 64 KiB C64 address space
 *   - init(subtune)    : run the SID init routine
 *   - reset_cpu(pc)    : reset registers and start at `pc`
 *   - start_frame(pc)  : start a new frame at `pc` (keeps registers)
 *   - run(maxCycles)   : execute until the play routine returns or until the
 *                        cycle budget is exhausted; returns cycles consumed
 *   - take_flags()     : SID/CIA addresses touched since the last call
 *   - pc(), halted()   : state inspection
 */

import type { ParsedSid } from './sid-file.ts';
import {
  BRANCH_FLAGS,
  FLAG_OPERATIONS,
  instructionLength,
  isAluGroup,
  isBranch,
  isControlGroup,
  isShiftGroup,
  isStackGroup,
} from './opcodes.ts';

const SID_FLAG_D404 = 1;
const SID_FLAG_D40B = 2;
const SID_FLAG_D412 = 4;
const CIA_FLAG_DC04 = 8;
const CIA_FLAG_DC05 = 16;

interface Env {
  pc: string;
  op(index: number): string;
  nextPC(length: number): string;
  staticPC: number | null;
}

interface Addressing {
  expr: string | null;
  cycles: number;
  setsAddr: boolean;
}

const i32 = (value: number) => `(i32.const ${value | 0})`;
const add = (a: string, b: string) => `(i32.add ${a} ${b})`;
const sub = (a: string, b: string) => `(i32.sub ${a} ${b})`;
const and = (a: string, b: string) => `(i32.and ${a} ${b})`;
const shl = (a: string, b: string) => `(i32.shl ${a} ${b})`;
const shr = (a: string, b: string) => `(i32.shr_u ${a} ${b})`;
const eqz = (a: string) => `(i32.eqz ${a})`;
const eq = (a: string, b: string) => `(i32.eq ${a} ${b})`;
const ne = (a: string, b: string) => `(i32.ne ${a} ${b})`;
const mask16 = (value: string) => and(value, i32(0xffff));
const rd = (addr: string) => `(call $rd ${addr})`;

function signExtend8(value: string): string {
  return sub(value, shl(and(shr(value, i32(7)), i32(1)), i32(8)));
}

export interface GeneratedModule {
  wat: string;
  /** Number of statically translated instruction addresses. */
  translated: number;
  /** Total addresses covered by the image. */
  total: number;
}

export function generateWat(parsed: ParsedSid): GeneratedModule {
  const { image, metadata } = parsed;
  const start = metadata.imageAddress;
  const end = start + image.length;
  const out: string[] = [];

  out.push('(module');
  out.push('  (import "env" "whittaker" (func $whittaker (param i32)))');
  out.push('  (type $instr (func))');
  out.push('  (memory (export "memory") 1 1)');
  out.push(`  (table $dispatch ${image.length} funcref)`);
  out.push('  (table $ops 256 funcref)');
  out.push('  (global $pc (mut i32) (i32.const 0))');
  out.push('  (global $a (mut i32) (i32.const 0))');
  out.push('  (global $x (mut i32) (i32.const 0))');
  out.push('  (global $y (mut i32) (i32.const 0))');
  out.push('  (global $sp (mut i32) (i32.const 0xff))');
  out.push('  (global $st (mut i32) (i32.const 0))');
  out.push('  (global $addr (mut i32) (i32.const 0))');
  out.push('  (global $storaddr (mut i32) (i32.const 0))');
  out.push('  (global $halt (mut i32) (i32.const 0))');
  out.push('  (global $flags (mut i32) (i32.const 0))');
  out.push('  (global $total (mut i64) (i64.const 0))');
  out.push('  (global $error (export "error") (mut i32) (i32.const 0))');

  emitHelpers(out, metadata.sidAddresses[1], metadata.sidAddresses[2]);

  // C64 memory image.
  out.push(`  (data (i32.const ${start}) "${escapeWatBytes(image)}")`);

  let translated = 0;
  if (image.length > 0) {
    const tableEntries: string[] = [];

    for (let address = start; address < end; address++) {
      const opcode = image[address - start]!;
      const length = instructionLength(opcode);
      if (address + length > end) {
        tableEntries.push('$interpret');
        continue;
      }
      translated++;
      emitStaticInstruction(out, address, opcode, image, start, end);
      tableEntries.push(`$f${address}`);
    }

    // Dispatch table for statically translated instructions.
    for (let i = 0; i < tableEntries.length; i += 24) {
      const chunk = tableEntries.slice(i, i + 24);
      const prefix = i === 0 ? `  (elem (table $dispatch) (i32.const 0) func` : '';
      const suffix = i + 24 >= tableEntries.length ? ')' : '';
      if (prefix) {
        out.push(`${prefix} ${chunk.join(' ')}${suffix}`);
      } else {
        out.push(`    ${chunk.join(' ')}${suffix}`);
      }
    }
  }

  // Generic interpreter handlers (used for bytes outside the image and for
  // self-modifying code whose instruction bytes no longer match).
  for (let opcode = 0; opcode < 256; opcode++) {
    emitDynamicHandler(out, opcode);
  }

  out.push('  (func $interpret');
  out.push('    (local $op i32)');
  out.push('    (local.set $op (call $rd (global.get $pc)))');
  out.push('    (call_indirect $ops (type $instr) (local.get $op)))');

  emitStep(out, start, end, image.length > 0);
  emitPublicApi(out, metadata.initAddress);

  const opEntries: string[] = [];
  for (let opcode = 0; opcode < 256; opcode++) opEntries.push(`$h${opcode}`);
  for (let i = 0; i < opEntries.length; i += 24) {
    const chunk = opEntries.slice(i, i + 24);
    const prefix = i === 0 ? '  (elem (table $ops) (i32.const 0) func' : '';
    const suffix = i + 24 >= opEntries.length ? ')' : '';
    if (prefix) {
      out.push(`${prefix} ${chunk.join(' ')}${suffix}`);
    } else {
      out.push(`    ${chunk.join(' ')}${suffix}`);
    }
  }

  out.push(')');
  return { wat: out.join('\n'), translated, total: image.length };
}

function emitHelpers(out: string[], sid2: number, sid3: number) {
  out.push(`  (func $rd (param $p i32) (result i32)
    (i32.load8_u (i32.and (local.get $p) (i32.const 0xffff))))`);
  out.push(`  (func $wr (param $p i32) (param $v i32)
    (i32.store8 (i32.and (local.get $p) (i32.const 0xffff))
                (i32.and (local.get $v) (i32.const 0xff))))`);
  out.push(`  (func $addcycles (param $n i32)
    (global.set $total
      (i64.add (global.get $total) (i64.extend_i32_u (local.get $n)))))`);
  out.push(`  (func $setnz (param $v i32)
    (global.set $st
      (i32.or
        (i32.and (global.get $st) (i32.const 125))
        (i32.or
          (i32.and (local.get $v) (i32.const 128))
          (i32.shl (i32.eqz (i32.and (local.get $v) (i32.const 255))) (i32.const 1))))))`);
  out.push(`  (func $push (param $v i32)
    (call $wr (i32.add (i32.const 0x100) (global.get $sp)) (local.get $v))
    (global.set $sp (i32.and (i32.sub (global.get $sp) (i32.const 1)) (i32.const 0xff))))`);
  out.push(`  (func $pop (result i32)
    (global.set $sp (i32.and (i32.add (global.get $sp) (i32.const 1)) (i32.const 0xff)))
    (call $rd (i32.add (i32.const 0x100) (global.get $sp))))`);
  out.push(`  (func $cmpv (param $lhs i32) (param $v i32)
    (local $t i32)
    (local.set $t (i32.sub (local.get $lhs) (local.get $v)))
    (global.set $st
      (i32.or
        (i32.and (global.get $st) (i32.const 124))
        (i32.or
          (i32.shl (i32.eqz (i32.and (local.get $t) (i32.const 255))) (i32.const 1))
          (i32.or
            (i32.and (local.get $t) (i32.const 128))
            (i32.ge_s (local.get $t) (i32.const 0)))))))`);
  out.push(`  (func $adc (param $v i32)
    (local $t i32)
    (local $r i32)
    (local.set $t (global.get $a))
    (local.set $r
      (i32.add (i32.add (local.get $t) (local.get $v))
               (i32.and (global.get $st) (i32.const 1))))
    (global.set $a (i32.and (local.get $r) (i32.const 255)))
    (global.set $st
      (i32.or
        (i32.and (global.get $st) (i32.const 20))
        (i32.or
          (i32.and (global.get $a) (i32.const 128))
          (i32.gt_u (local.get $r) (i32.const 255)))))
    (global.set $st
      (i32.or
        (global.get $st)
        (i32.or
          (i32.shl (i32.eqz (global.get $a)) (i32.const 1))
          (i32.shr_u
            (i32.and
              (i32.eqz (i32.and (i32.xor (local.get $t) (local.get $v)) (i32.const 128)))
              (i32.and (i32.xor (local.get $t) (global.get $a)) (i32.const 128)))
            (i32.const 1))))))`);
  out.push(`  (func $sbc (param $v i32)
    (local $t i32)
    (local $r i32)
    (local.set $t (global.get $a))
    (local.set $r
      (i32.sub (i32.sub (local.get $t) (local.get $v))
               (i32.sub (i32.const 1) (i32.and (global.get $st) (i32.const 1)))))
    (global.set $a (i32.and (local.get $r) (i32.const 255)))
    (global.set $st
      (i32.or
        (i32.and (global.get $st) (i32.const 20))
        (i32.or
          (i32.and (global.get $a) (i32.const 128))
          (i32.ge_s (local.get $r) (i32.const 0)))))
    (global.set $st
      (i32.or
        (global.get $st)
        (i32.or
          (i32.shl (i32.eqz (global.get $a)) (i32.const 1))
          (i32.shr_u
            (i32.and
              (i32.and (i32.xor (local.get $t) (local.get $v)) (i32.const 128))
              (i32.and (i32.xor (local.get $t) (global.get $a)) (i32.const 128)))
            (i32.const 1))))))`);
  out.push(`  (func $rol (param $v i32) (result i32)
    (local $t i32)
    (local.set $t
      (i32.add (i32.shl (local.get $v) (i32.const 1))
               (i32.and (global.get $st) (i32.const 1))))
    (global.set $st
      (i32.or
        (i32.and (global.get $st) (i32.const 60))
        (i32.or
          (i32.and (local.get $t) (i32.const 128))
          (i32.gt_u (local.get $t) (i32.const 255)))))
    (local.set $t (i32.and (local.get $t) (i32.const 255)))
    (global.set $st
      (i32.or (global.get $st) (i32.shl (i32.eqz (local.get $t)) (i32.const 1))))
    (local.get $t))`);
  out.push(`  (func $ror (param $v i32) (result i32)
    (local $t i32)
    (local.set $t
      (i32.add (i32.shr_u (local.get $v) (i32.const 1))
               (i32.mul (i32.and (global.get $st) (i32.const 1)) (i32.const 128))))
    (global.set $st
      (i32.or
        (i32.and (global.get $st) (i32.const 60))
        (i32.or
          (i32.and (local.get $t) (i32.const 128))
          (i32.and (local.get $v) (i32.const 1)))))
    (local.set $t (i32.and (local.get $t) (i32.const 255)))
    (global.set $st
      (i32.or (global.get $st) (i32.shl (i32.eqz (local.get $t)) (i32.const 1))))
    (local.get $t))`);

  // Per-instruction side effects that live outside the CPU core.
  const storaddr = '(global.get $storaddr)';
  const inSid2 = sid2
    ? and(`i32.ge_u ${storaddr} ${i32(sid2)}`, `i32.lt_u ${storaddr} ${i32(sid2 + 0x1f)}`)
    : 'i32.const 0';
  const inSid3 = sid3
    ? and(`i32.ge_u ${storaddr} ${i32(sid3)}`, `i32.lt_u ${storaddr} ${i32(sid3 + 0x1f)}`)
    : 'i32.const 0';
  out.push(`  (func $post
    ;; Galway/Rubicon mirroring for writes in $D420-$D7FF.
    (if (i32.and
          (i32.ge_u ${storaddr} (i32.const 0xd420))
          (i32.lt_u ${storaddr} (i32.const 0xd800)))
      (then
        (if (i32.ne (i32.and (call $rd (i32.const 1)) (i32.const 3)) (i32.const 0))
          (then
            (if (i32.and (i32.eqz (${inSid2})) (i32.eqz (${inSid3})))
              (then
                (call $wr
                  (i32.and ${storaddr} (i32.const 0xd41f))
                  (call $rd ${storaddr}))))))))
    ;; Report SID/CIA addresses touched so the JS wrapper can update its
    ;; SID envelope state and CIA timing.
    (if ${eq('(global.get $addr)', i32(0xd404))}
      (then (global.set $flags (i32.or (global.get $flags) (i32.const ${SID_FLAG_D404}))) (call $whittaker (global.get $addr))))
    (if ${eq('(global.get $addr)', i32(0xd40b))}
      (then (global.set $flags (i32.or (global.get $flags) (i32.const ${SID_FLAG_D40B})))))
    (if ${eq('(global.get $addr)', i32(0xd412))}
      (then (global.set $flags (i32.or (global.get $flags) (i32.const ${SID_FLAG_D412})))))
    (if ${eq('(global.get $addr)', i32(0xdc04))}
      (then (global.set $flags (i32.or (global.get $flags) (i32.const ${CIA_FLAG_DC04})))))
    (if ${eq('(global.get $addr)', i32(0xdc05))}
      (then (global.set $flags (i32.or (global.get $flags) (i32.const ${CIA_FLAG_DC05})))))
  )`);
}

function emitStaticInstruction(
  out: string[],
  address: number,
  opcode: number,
  image: Uint8Array,
  imageStart: number,
  imageEnd: number,
) {
  const length = instructionLength(opcode);
  out.push(`  (func $f${address}`);
  out.push('    (local $t i32) (local $r i32) (local $lo i32) (local $hi i32)');
  out.push(
    `    (if (i32.ne (i32.load8_u (i32.const ${address})) (i32.const ${opcode}))\n` +
      `      (then (call $interpret) (return)))`,
  );
  for (let i = 1; i < length; i++) {
    const expected = address + i < imageEnd ? image[address + i - imageStart]! : 0;
    out.push(
      `    (if (i32.ne (i32.load8_u (i32.const ${address + i})) (i32.const ${expected}))\n` +
        `      (then (call $interpret) (return)))`,
    );
  }

  const env: Env = {
    pc: i32(address),
    op: (index) => i32(image[address + index - imageStart]!),
    nextPC: (len) => i32((address + len) & 0xffff),
    staticPC: address,
  };
  emitBody(out, opcode, env);
  out.push('  )');
}

function emitDynamicHandler(out: string[], opcode: number) {
  out.push(`  (func $h${opcode}`);
  out.push('    (local $t i32) (local $r i32) (local $lo i32) (local $hi i32)');
  const env: Env = {
    pc: '(global.get $pc)',
    op: (index) => rd(mask16(add('(global.get $pc)', i32(index)))),
    nextPC: (len) => mask16(add('(global.get $pc)', i32(len))),
    staticPC: null,
  };
  emitBody(out, opcode, env);
  out.push('  )');
}

function emitBody(out: string[], opcode: number, env: Env) {
  const info = analyzeAddressing(opcode, env);
  if (info.setsAddr && info.expr) {
    out.push(`    (global.set $addr ${info.expr})`);
  }

  if (isAluGroup(opcode)) {
    emitAlu(out, opcode, env, info);
    return;
  }
  if (isShiftGroup(opcode)) {
    emitShift(out, opcode, env, info);
    return;
  }
  if (isStackGroup(opcode)) {
    emitStack(out, opcode);
    emitCycles(out, info.cycles);
    emitNext(out, env, instructionLength(opcode));
    return;
  }
  if (isBranch(opcode)) {
    emitBranch(out, opcode, env);
    return;
  }
  if (isControlGroup(opcode)) {
    emitControl(out, opcode, env, info);
    return;
  }

  out.push('    (global.set $error (i32.const 65535))');
  out.push('    (global.set $halt (i32.const 1))');
}

function emitAlu(out: string[], opcode: number, env: Env, info: Addressing) {
  // Illegal opcodes without an addressing-mode case keep using the previous
  // instruction's `$addr`, matching src/cpu.ts.
  const expr = info.expr ?? '(global.get $addr)';
  const value = rd(expr);

  switch (opcode & 0xe0) {
    case 0x60:
      out.push(`    (call $adc ${value})`);
      break;
    case 0xe0:
      out.push(`    (call $sbc ${value})`);
      break;
    case 0xc0:
      out.push(`    (call $cmpv (global.get $a) ${value})`);
      break;
    case 0x00:
      out.push(`    (global.set $a (i32.and (i32.or (global.get $a) ${value}) (i32.const 255)))`);
      out.push('    (call $setnz (global.get $a))');
      break;
    case 0x20:
      out.push(`    (global.set $a (i32.and (i32.and (global.get $a) ${value}) (i32.const 255)))`);
      out.push('    (call $setnz (global.get $a))');
      break;
    case 0x40:
      out.push(`    (global.set $a (i32.and (i32.xor (global.get $a) ${value}) (i32.const 255)))`);
      out.push('    (call $setnz (global.get $a))');
      break;
    case 0xa0:
      out.push(`    (global.set $a (i32.and ${value} (i32.const 255)))`);
      out.push('    (call $setnz (global.get $a))');
      if ((opcode & 3) === 3) {
        out.push('    (global.set $x (global.get $a))');
      }
      break;
    case 0x80: {
      const stored =
        (opcode & 3) === 3 ? '(i32.and (global.get $a) (global.get $x))' : '(global.get $a)';
      out.push(`    (call $wr ${expr} ${stored})`);
      out.push(`    (global.set $storaddr ${expr})`);
      break;
    }
  }

  emitCycles(out, info.cycles);
  emitNext(out, env, instructionLength(opcode));
}

function emitShift(out: string[], opcode: number, env: Env, info: Addressing) {
  const expr = info.expr ?? '(global.get $addr)';
  const low = opcode & 0x0f;

  switch (opcode & 0xe0) {
    case 0x00:
    case 0x20: {
      // src/cpu.ts clears the carry before ASL (0x00 group); ROL (0x20) keeps it.
      if ((opcode & 0xe0) === 0x00) {
        out.push('    (global.set $st (i32.and (global.get $st) (i32.const 0xfe)))');
      }
      if (low === 0x0a) {
        out.push('    (global.set $a (call $rol (global.get $a)))');
      } else {
        out.push(`    (call $wr ${expr} (call $rol ${rd(expr!)}))`);
        emitCycles(out, 2);
      }
      break;
    }
    case 0x40:
    case 0x60: {
      // Likewise LSR (0x40) clears the carry first; ROR (0x60) keeps it.
      if ((opcode & 0xe0) === 0x40) {
        out.push('    (global.set $st (i32.and (global.get $st) (i32.const 0xfe)))');
      }
      if (low === 0x0a) {
        out.push('    (global.set $a (call $ror (global.get $a)))');
      } else {
        out.push(`    (call $wr ${expr} (call $ror ${rd(expr!)}))`);
        emitCycles(out, 2);
      }
      break;
    }
    case 0xc0:
      if (opcode & 4) {
        out.push(
          `    (call $wr ${expr} (i32.and (i32.sub ${rd(expr!)} (i32.const 1)) (i32.const 255)))`,
        );
        out.push(`    (call $setnz ${rd(expr!)})`);
        emitCycles(out, 2);
      } else {
        out.push(
          '    (global.set $x (i32.and (i32.sub (global.get $x) (i32.const 1)) (i32.const 255)))',
        );
        out.push('    (call $setnz (global.get $x))');
      }
      break;
    case 0xa0:
      if (low !== 0x0a) {
        out.push(`    (global.set $x ${rd(expr!)})`);
      } else if (opcode & 0x10) {
        out.push('    (global.set $x (global.get $sp))');
      } else {
        out.push('    (global.set $x (global.get $a))');
      }
      out.push('    (call $setnz (global.get $x))');
      break;
    case 0x80:
      if (opcode & 4) {
        out.push(`    (call $wr ${expr} (global.get $x))`);
        out.push(`    (global.set $storaddr ${expr})`);
      } else if (opcode & 0x10) {
        out.push('    (global.set $sp (global.get $x))');
      } else {
        out.push('    (global.set $a (global.get $x))');
        out.push('    (call $setnz (global.get $a))');
      }
      break;
    case 0xe0:
      if (opcode & 4) {
        out.push(
          `    (call $wr ${expr} (i32.and (i32.add ${rd(expr!)} (i32.const 1)) (i32.const 255)))`,
        );
        out.push(`    (call $setnz ${rd(expr!)})`);
        emitCycles(out, 2);
      }
      break;
  }

  emitCycles(out, info.cycles);
  emitNext(out, env, instructionLength(opcode));
}

function emitStack(out: string[], opcode: number) {
  switch (opcode & 0xf0) {
    case 0x60:
      out.push('    (global.set $a (call $pop))');
      out.push('    (call $setnz (global.get $a))');
      break;
    case 0xc0:
      out.push(
        '    (global.set $y (i32.and (i32.add (global.get $y) (i32.const 1)) (i32.const 255)))',
      );
      out.push('    (call $setnz (global.get $y))');
      break;
    case 0xe0:
      out.push(
        '    (global.set $x (i32.and (i32.add (global.get $x) (i32.const 1)) (i32.const 255)))',
      );
      out.push('    (call $setnz (global.get $x))');
      break;
    case 0x80:
      out.push(
        '    (global.set $y (i32.and (i32.sub (global.get $y) (i32.const 1)) (i32.const 255)))',
      );
      out.push('    (call $setnz (global.get $y))');
      break;
    case 0x00:
      out.push('    (call $push (global.get $st))');
      break;
    case 0x20:
      out.push('    (global.set $st (call $pop))');
      break;
    case 0x40:
      out.push('    (call $push (global.get $a))');
      break;
    case 0x90:
      out.push('    (global.set $a (global.get $y))');
      out.push('    (call $setnz (global.get $a))');
      break;
    case 0xa0:
      out.push('    (global.set $y (global.get $a))');
      out.push('    (call $setnz (global.get $y))');
      break;
    default: {
      const flagOperation = FLAG_OPERATIONS[opcode >> 5]!;
      const mask = flagOperation & 0xdf;
      if (flagOperation & 0x20) {
        out.push(`    (global.set $st (i32.or (global.get $st) ${i32(mask)}))`);
      } else {
        out.push(`    (global.set $st (i32.and (global.get $st) ${i32(255 - mask)}))`);
      }
      break;
    }
  }
}

function emitBranch(out: string[], opcode: number, env: Env) {
  const flag = BRANCH_FLAGS[opcode >> 6]!;
  const condition =
    opcode & 0x20
      ? ne(and('(global.get $st)', i32(flag)), i32(0))
      : eqz(and('(global.get $st)', i32(flag)));
  const target =
    env.staticPC !== null
      ? i32((env.staticPC + 2 + signedByte(env, 1)) & 0xffff)
      : mask16(add(env.pc, add(i32(2), signExtend8(env.op(1)))));
  const next = env.nextPC(2);

  out.push(`    (if ${condition}`);
  out.push(`      (then (global.set $pc ${target}) (call $addcycles (i32.const 3)))`);
  out.push(`      (else (global.set $pc ${next}) (call $addcycles (i32.const 2))))`);
}

function emitControl(out: string[], opcode: number, env: Env, info: Addressing) {
  const expr = info.expr ?? '(global.get $addr)';

  switch (opcode & 0xe0) {
    case 0x00: {
      // BRK (and the illegal NOP opcodes that fall into this branch).
      // src/cpu.ts pushes the PC left after operand fetches, i.e. opcode+length.
      const length = instructionLength(opcode);
      const pushed =
        env.staticPC !== null
          ? i32((env.staticPC + length) & 0xffff)
          : mask16(add(env.pc, i32(length)));
      out.push(`    (call $push (i32.and ${pushed} (i32.const 255)))`);
      out.push(`    (call $push (i32.and (i32.shr_u ${pushed} (i32.const 8)) (i32.const 255)))`);
      out.push('    (call $push (global.get $st))');
      out.push(
        `    (global.set $pc (i32.and (i32.add (call $rd (i32.const 0xfffe)) (i32.shl (call $rd (i32.const 0xffff)) (i32.const 8))) (i32.const 0xffff)))`,
      );
      emitCycles(out, 7);
      return;
    }
    case 0x20:
      if (opcode & 0x0f) {
        // BIT
        const value = rd(expr!);
        out.push(
          `    (global.set $st (i32.or (i32.and (global.get $st) (i32.const 0x3d)) (i32.or (i32.and ${value} (i32.const 0xc0)) (i32.shl (i32.eqz (i32.and (global.get $a) ${value})) (i32.const 1)))))`,
        );
        emitCycles(out, info.cycles);
        emitNext(out, env, instructionLength(opcode));
        return;
      }
      // JSR
      {
        const returnAddress =
          env.staticPC !== null ? i32((env.staticPC + 3) & 0xffff) : mask16(add(env.pc, i32(3)));
        out.push(`    (call $push (i32.and ${returnAddress} (i32.const 255)))`);
        out.push(
          `    (call $push (i32.and (i32.shr_u ${returnAddress} (i32.const 8)) (i32.const 255)))`,
        );
        const target = mask16(add(rd(expr!), shl(rd(add(expr!, i32(1))), i32(8))));
        out.push(`    (global.set $pc ${target})`);
        emitCycles(out, 6);
        return;
      }
    case 0x40:
      if (opcode & 0x0f) {
        // JMP absolute / absolute indexed (illegal opcodes use this too).
        out.push(`    (global.set $pc ${expr})`);
        emitCycles(out, 3);
        return;
      }
      // RTI
      out.push(
        `    (if (i32.ge_u (global.get $sp) (i32.const 0xff)) (then (global.set $pc ${mask16(add(env.pc, i32(1)))}) (global.set $halt (i32.const 1)) (return)))`,
      );
      out.push('    (global.set $st (call $pop))');
      out.push('    (local.set $hi (call $pop))');
      out.push('    (local.set $lo (call $pop))');
      out.push(
        '    (global.set $pc (i32.and (i32.add (local.get $lo) (i32.shl (local.get $hi) (i32.const 8))) (i32.const 0xffff)))',
      );
      emitCycles(out, 6);
      return;
    case 0x60:
      if (opcode & 0x0f) {
        // JMP (indirect)
        const target = mask16(add(rd(expr!), shl(rd(add(expr!, i32(1))), i32(8))));
        out.push(`    (global.set $pc ${target})`);
        emitCycles(out, 5);
        return;
      }
      // RTS
      out.push(
        `    (if (i32.eq (global.get $sp) (i32.const 0xff)) (then (global.set $pc ${mask16(add(env.pc, i32(1)))}) (global.set $halt (i32.const 1)) (return)))`,
      );
      out.push('    (local.set $hi (call $pop))');
      out.push('    (local.set $lo (call $pop))');
      out.push(
        '    (global.set $pc (i32.and (i32.add (local.get $lo) (i32.shl (local.get $hi) (i32.const 8))) (i32.const 0xffff)))',
      );
      emitCycles(out, 6);
      return;
    case 0xc0:
      out.push(`    (call $cmpv (global.get $y) ${rd(expr!)})`);
      break;
    case 0xe0:
      out.push(`    (call $cmpv (global.get $x) ${rd(expr!)})`);
      break;
    case 0xa0:
      out.push(`    (global.set $y (i32.and ${rd(expr!)} (i32.const 255)))`);
      out.push('    (call $setnz (global.get $y))');
      break;
    case 0x80:
      out.push(`    (call $wr ${expr} (global.get $y))`);
      out.push(`    (global.set $storaddr ${expr})`);
      break;
  }

  emitCycles(out, info.cycles);
  emitNext(out, env, instructionLength(opcode));
}

function analyzeAddressing(opcode: number, env: Env): Addressing {
  if (isAluGroup(opcode)) {
    switch (opcode & 0x1f) {
      case 0x01:
      case 0x03:
        return { expr: indirectX(env), cycles: 6, setsAddr: true };
      case 0x11:
      case 0x13:
        return { expr: indirectY(env), cycles: 6, setsAddr: true };
      case 0x19:
      case 0x1f:
        return { expr: absoluteY(env), cycles: 5, setsAddr: true };
      case 0x1d:
        return { expr: absoluteX(env), cycles: 5, setsAddr: true };
      case 0x0d:
      case 0x0f:
        return { expr: absolute(env), cycles: 4, setsAddr: true };
      case 0x15:
        return { expr: zeroPageX(env), cycles: 4, setsAddr: true };
      case 0x05:
      case 0x07:
        return { expr: zeroPage(env), cycles: 3, setsAddr: true };
      case 0x17:
        return { expr: zeroPageY(env), cycles: 4, setsAddr: true };
      case 0x09:
      case 0x0b:
        return { expr: immediate(env), cycles: 2, setsAddr: true };
      default:
        return { expr: null, cycles: 2, setsAddr: false };
    }
  }

  if (isShiftGroup(opcode)) {
    switch (opcode & 0x1f) {
      case 0x1e:
        return {
          expr: (opcode & 0xc0) === 0x80 ? absoluteY(env) : absoluteX(env),
          cycles: 5,
          setsAddr: true,
        };
      case 0x0e:
        return { expr: absolute(env), cycles: 4, setsAddr: true };
      case 0x16:
        return {
          expr: (opcode & 0xc0) === 0x80 ? zeroPageY(env) : zeroPageX(env),
          cycles: 4,
          setsAddr: true,
        };
      case 0x06:
        return { expr: zeroPage(env), cycles: 3, setsAddr: true };
      case 0x02:
        return { expr: immediate(env), cycles: 2, setsAddr: true };
      default:
        return { expr: null, cycles: 2, setsAddr: false };
    }
  }

  if (isStackGroup(opcode)) {
    return { expr: null, cycles: stackCycles(opcode), setsAddr: false };
  }

  if (isBranch(opcode)) {
    return { expr: null, cycles: 2, setsAddr: false };
  }

  switch (opcode & 0x1f) {
    case 0x00:
      return { expr: immediate(env), cycles: 2, setsAddr: true };
    case 0x1c:
      return { expr: absoluteX(env), cycles: 5, setsAddr: true };
    case 0x0c:
      return { expr: absolute(env), cycles: 4, setsAddr: true };
    case 0x14:
      return { expr: zeroPageX(env), cycles: 4, setsAddr: true };
    case 0x04:
      return { expr: zeroPage(env), cycles: 3, setsAddr: true };
    default:
      return { expr: null, cycles: 2, setsAddr: false };
  }
}

function immediate(env: Env): string {
  return env.staticPC !== null ? i32((env.staticPC + 1) & 0xffff) : mask16(add(env.pc, i32(1)));
}

function zeroPage(env: Env): string {
  return env.op(1);
}

function zeroPageX(env: Env): string {
  return mask16(add(env.op(1), '(global.get $x)'));
}

function zeroPageY(env: Env): string {
  return mask16(add(env.op(1), '(global.get $y)'));
}

function absolute(env: Env): string {
  return mask16(add(env.op(1), shl(env.op(2), i32(8))));
}

function absoluteX(env: Env): string {
  return mask16(add(absolute(env), '(global.get $x)'));
}

function absoluteY(env: Env): string {
  return mask16(add(absolute(env), '(global.get $y)'));
}

function indirectX(env: Env): string {
  const base = add(env.op(1), '(global.get $x)');
  return mask16(and(rd(base), shl(rd(add(base, i32(1))), i32(8))));
}

function indirectY(env: Env): string {
  const base = env.op(1);
  return mask16(add(add(rd(base), shl(rd(add(base, i32(1))), i32(8))), '(global.get $y)'));
}

function stackCycles(opcode: number): number {
  switch (opcode & 0xf0) {
    case 0x60:
    case 0x20:
      return 4;
    case 0x00:
    case 0x40:
      return 3;
    default:
      return 2;
  }
}

function signedByte(env: Env, index: number): number {
  const value = Number(env.op(index).match(/i32\.const (-?\d+)/)?.[1] ?? 0);
  return value & 0x80 ? value - 0x100 : value;
}

function emitCycles(out: string[], cycles: number) {
  out.push(`    (call $addcycles (i32.const ${cycles}))`);
}

function emitNext(out: string[], env: Env, length: number) {
  out.push(`    (global.set $pc ${env.nextPC(length)})`);
}

function emitStep(out: string[], start: number, end: number, hasImage: boolean) {
  const dispatch = hasImage
    ? `    (if (i32.and
          (i32.ge_u (local.get $p) (i32.const ${start}))
          (i32.lt_u (local.get $p) (i32.const ${end})))
      (then
        (call_indirect $dispatch (type $instr)
          (i32.sub (local.get $p) (i32.const ${start}))))
      (else (call $interpret)))`
    : '    (call $interpret)';
  out.push(`  (func $step
    (local $p i32)
    (local.set $p (global.get $pc))
    (global.set $storaddr (i32.const 0))
${dispatch}
    (call $post))`);
}

function emitPublicApi(out: string[], initAddress: number) {
  out.push(`  (func (export "init") (param $subtune i32)
    (local $i i32)
    (global.set $pc (i32.const ${initAddress}))
    (global.set $a (i32.and (local.get $subtune) (i32.const 255)))
    (global.set $x (i32.const 0))
    (global.set $y (i32.const 0))
    (global.set $st (i32.const 0))
    (global.set $sp (i32.const 0xff))
    (global.set $halt (i32.const 0))
    (global.set $flags (i32.const 0))
    (global.set $error (i32.const 0))
    (call $wr (i32.const 1) (i32.const 0x37))
    (call $wr (i32.const 0xdc05) (i32.const 0))
    (local.set $i (i32.const 100000))
    (block $done
      (loop $loop
        (br_if $done (i32.eqz (local.get $i)))
        (br_if $done (i32.ne (global.get $halt) (i32.const 0)))
        (call $step)
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (br $loop))))`);

  out.push(`  (func (export "reset_cpu") (param $pc i32)
    (global.set $pc (i32.and (local.get $pc) (i32.const 0xffff)))
    (global.set $a (i32.const 0))
    (global.set $x (i32.const 0))
    (global.set $y (i32.const 0))
    (global.set $st (i32.const 0))
    (global.set $sp (i32.const 0xff))
    (global.set $halt (i32.const 0))
    (global.set $flags (i32.const 0))
    (global.set $error (i32.const 0)))`);

  out.push(`  (func (export "start_frame") (param $pc i32)
    (global.set $pc (i32.and (local.get $pc) (i32.const 0xffff)))
    (global.set $sp (i32.const 0xff))
    (global.set $halt (i32.const 0))
    (global.set $flags (i32.const 0)))`);

  out.push(`  (func (export "run") (param $max f64) (result i32)
    (local $spent i32)
    (local $start i64)
    (local $prev i64)
    (local.set $start (global.get $total))
    (block $done
      (loop $loop
        (br_if $done (i32.ne (global.get $halt) (i32.const 0)))
        (br_if $done (f64.gt (f64.convert_i32_s (local.get $spent)) (local.get $max)))
        (local.set $prev (global.get $total))
        (call $step)
        (if (i32.ne (global.get $halt) (i32.const 0))
          (then (global.set $total (local.get $prev)))
          (else
            (local.set $spent
              (i32.wrap_i64 (i64.sub (global.get $total) (local.get $start))))))
        (br $loop)))
    (local.get $spent))`);

  out.push(`  (func (export "take_flags") (result i32)
    (local $f i32)
    (local.set $f (global.get $flags))
    (global.set $flags (i32.const 0))
    (local.get $f))`);
  out.push('  (func (export "pc") (result i32) (global.get $pc))');
  out.push('  (func (export "sp") (result i32) (global.get $sp))');
  out.push('  (func (export "a") (result i32) (global.get $a))');
  out.push('  (func (export "x") (result i32) (global.get $x))');
  out.push('  (func (export "y") (result i32) (global.get $y))');
  out.push('  (func (export "st") (result i32) (global.get $st))');
  out.push('  (func (export "total_cycles") (result i64) (global.get $total))');
  out.push('  (func (export "step") (call $step))');
  out.push('  (func (export "halted") (result i32) (global.get $halt))');
  out.push(`  (func (export "set_pc") (param $pc i32)
    (global.set $pc (i32.and (local.get $pc) (i32.const 0xffff))))`);
  out.push(`  (func (export "set_sp") (param $sp i32)
    (global.set $sp (i32.and (local.get $sp) (i32.const 0xff))))`);
  out.push('  (func (export "addcycles") (param $n i32) (call $addcycles (local.get $n)))');
}

function escapeWatBytes(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) {
    result += `\\${byte.toString(16).padStart(2, '0')}`;
  }
  return result;
}

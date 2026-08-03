#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path

BASE_REPAIR_COMMIT = '35e5de54c77122529e33701a26ca8c0bd207d25b'
base_repair = subprocess.check_output(
    ['git', 'show', f'{BASE_REPAIR_COMMIT}:scripts/repair_transaction_state.py'],
    text=True,
)
exec(compile(base_repair, 'repair_transaction_state.py', 'exec'))

state_path = Path('src/security/internal-state.ts')
state_source = state_path.read_text(encoding='utf-8')
old = """    async ensureJson(relativePath, value) {
      if (!(await this.fileExists(relativePath))) {
        await this.writeJson(relativePath, value);
      }
    },
"""
new = """    async ensureJson(relativePath, value) {
      const state = this as ProjectInternalState;
      if (!(await state.fileExists(relativePath))) {
        await state.writeJson(relativePath, value);
      }
    },
"""
if state_source.count(old) != 1:
    raise SystemExit(
        f'expected one TypeScript-7 internal-state inference block, found {state_source.count(old)}'
    )
state_path.write_text(state_source.replace(old, new, 1), encoding='utf-8')

from pathlib import Path

base = Path(__file__).resolve().parent / "_patch_financial_idempotency_phase2b.py"
source = base.read_text(encoding="utf-8")

old = '''    text = replace_once(
        text,
        '  const [description, setDescription] = useState<string>("\\");\\n',
        '  const [description, setDescription] = useState<string>("\\");\\n  const [saving, setSaving] = useState(false);\\n',
        "tx modal saving state",
    )
'''
# The source literal contains escaped quotes/newline tokens exactly as written in the patch file.
if old not in source:
    old = '''    text = replace_once(
        text,
        '  const [description, setDescription] = useState<string>("");\\n',
        '  const [description, setDescription] = useState<string>("");\\n  const [saving, setSaving] = useState(false);\\n',
        "tx modal saving state",
    )
'''

new = '''    tx_anchor = text.find("function TxModal({")
    if tx_anchor < 0:
        raise RuntimeError("tx modal anchor missing")
    tx_state = '  const [description, setDescription] = useState<string>("");\\n'
    tx_state_idx = text.find(tx_state, tx_anchor)
    cash_anchor_idx = text.find("function CashMovementModal({", tx_anchor)
    if tx_state_idx < 0 or (cash_anchor_idx >= 0 and tx_state_idx > cash_anchor_idx):
        raise RuntimeError("tx modal description state missing")
    text = text[:tx_state_idx] + tx_state + '  const [saving, setSaving] = useState(false);\\n' + text[tx_state_idx + len(tx_state):]
'''

if old not in source:
    raise RuntimeError("could not locate phase2b tx modal state patch block")
source = source.replace(old, new, 1)

namespace = {
    "__name__": "__main__",
    "__file__": str(base),
}
exec(compile(source, str(base), "exec"), namespace)

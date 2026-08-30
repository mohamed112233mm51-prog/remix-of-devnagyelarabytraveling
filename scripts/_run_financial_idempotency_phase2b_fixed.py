from pathlib import Path

base = Path(__file__).resolve().parent / "_patch_financial_idempotency_phase2b.py"
source = base.read_text(encoding="utf-8")

# 1) TxModal and CashMovementModal both have the same description state.
old_state = '''    text = replace_once(
        text,
        '  const [description, setDescription] = useState<string>("");\\n',
        '  const [description, setDescription] = useState<string>("");\\n  const [saving, setSaving] = useState(false);\\n',
        "tx modal saving state",
    )
'''
new_state = '''    tx_anchor = text.find("function TxModal({")
    if tx_anchor < 0:
        raise RuntimeError("tx modal anchor missing")
    tx_state = '  const [description, setDescription] = useState<string>("");\\n'
    tx_state_idx = text.find(tx_state, tx_anchor)
    cash_anchor_idx = text.find("function CashMovementModal({", tx_anchor)
    if tx_state_idx < 0 or (cash_anchor_idx >= 0 and tx_state_idx > cash_anchor_idx):
        raise RuntimeError("tx modal description state missing")
    text = text[:tx_state_idx] + tx_state + '  const [saving, setSaving] = useState(false);\\n' + text[tx_state_idx + len(tx_state):]
'''
if old_state not in source:
    raise RuntimeError("could not locate phase2b tx modal state patch block")
source = source.replace(old_state, new_state, 1)

# 2) Both supplier modals also use the exact same save-button markup.
old_button_patch = '''    text = replace_once(
        text,
        '<button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save}>💾 حفظ الحركة</button>',
        '<button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ التأكيد..." : "💾 حفظ الحركة"}</button>',
        "trade button",
    )
'''
new_button_patch = '''    tx_button_old = '<button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save}>💾 حفظ الحركة</button>'
    tx_button_new = '<button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ التأكيد..." : "💾 حفظ الحركة"}</button>'
    tx_anchor = text.find("function TxModal({")
    cash_anchor_for_button = text.find("function CashMovementModal({", tx_anchor)
    tx_button_idx = text.find(tx_button_old, tx_anchor)
    if tx_button_idx < 0 or (cash_anchor_for_button >= 0 and tx_button_idx > cash_anchor_for_button):
        raise RuntimeError("trade button not found inside TxModal")
    text = text[:tx_button_idx] + tx_button_new + text[tx_button_idx + len(tx_button_old):]
'''
if old_button_patch not in source:
    raise RuntimeError("could not locate phase2b trade button patch block")
source = source.replace(old_button_patch, new_button_patch, 1)

namespace = {
    "__name__": "__main__",
    "__file__": str(base),
}
exec(compile(source, str(base), "exec"), namespace)

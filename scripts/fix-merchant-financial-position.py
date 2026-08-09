from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/hooks/useFinancialPosition.ts",
    '''    // تجار الكاش: computeMerchantAggregates يعيد صافي كل تاجر منفرداً.\n    // موجب كشف التاجر = رصيد لدى النظام لصالح هذا التاجر (التزام علينا)، لذلك نعكس الإشارة.\n    const merchantAggregates = computeMerchantAggregates({\n      txns: transactions,\n      companyTxns: companyTransactions,\n      collections: merchantCollections,\n      usdRows: usdTreasuryRows,\n      splits: paymentSplits as any,\n    });\n    for (const aggregate of merchantAggregates.values()) {\n      mergeSignedBalances(merchantsSection, aggregate.balance, -1);\n    }''',
    '''    // تجار الكاش: computeMerchantAggregates يعيد صافي كل تاجر منفرداً.\n    // موجب كشف التاجر = أموال للشركة موجودة لدى هذا التاجر (أصل شبيه بالخزينة).\n    // سالب كشف التاجر = التزام على الشركة لصالح هذا التاجر.\n    const merchantAggregates = computeMerchantAggregates({\n      txns: transactions,\n      companyTxns: companyTransactions,\n      collections: merchantCollections,\n      usdRows: usdTreasuryRows,\n      splits: paymentSplits as any,\n    });\n    for (const aggregate of merchantAggregates.values()) {\n      mergeSignedBalances(merchantsSection, aggregate.balance, 1);\n    }''',
    "merchant sign",
)

replace_once(
    "src/hooks/useFinancialPosition.ts",
    '''    for (const box of cashBoxes) {\n      if (box.is_active === false) continue;\n      const currency = String(box.currency || "EGP").toUpperCase();\n      const amount = Number(box.balance) || 0;\n      treasury.add(currency, amount);\n      if (amount >= 0) treasuryAssets.add(currency, amount);\n      else treasuryLiabilities.add(currency, Math.abs(amount));\n    }\n\n    const receivables = new CurrencyMap();\n    const payables = new CurrencyMap();\n    for (const section of sections) {\n      receivables.merge(section.receivable);\n      payables.merge(section.payable);\n    }''',
    '''    for (const box of cashBoxes) {\n      if (box.is_active === false) continue;\n      const currency = String(box.currency || "EGP").toUpperCase();\n      const amount = Number(box.balance) || 0;\n      treasury.add(currency, amount);\n      if (amount >= 0) treasuryAssets.add(currency, amount);\n      else treasuryLiabilities.add(currency, Math.abs(amount));\n    }\n\n    // رصيد تاجر الكاش الموجب يعتبر من أموال الشركة المتاحة مثل الخزينة،\n    // لذلك نضيفه للخزائن/الأصول ولا نكرره مرة ثانية ضمن المستحقات.\n    treasury.merge(merchantsSection.receivable);\n    treasuryAssets.merge(merchantsSection.receivable);\n\n    const receivables = new CurrencyMap();\n    const payables = new CurrencyMap();\n    for (const section of sections) {\n      if (section.key !== "merchants") receivables.merge(section.receivable);\n      payables.merge(section.payable);\n    }''',
    "merchant treasury classification",
)

replace_once(
    "src/components/FinancialPositionPanel.tsx",
    'label="أرصدة خزائن الشركة"',
    'label="الخزائن + أموال الشركة لدى تجار الكاش"',
    "dashboard treasury label",
)
replace_once(
    "src/components/FinancialPositionPanel.tsx",
    'sub="الأموال الموجودة فعلياً في الخزائن"',
    'sub="الخزائن الفعلية + أرصدة تجار الكاش الموجبة"',
    "dashboard treasury subtitle",
)
replace_once(
    "src/components/FinancialPositionPanel.tsx",
    '<FullCard label="الخزائن" map={position.treasury} className="gold" />',
    '<FullCard label="الخزائن + أموال الشركة لدى تجار الكاش" map={position.treasury} className="gold" />',
    "full treasury label",
)
replace_once(
    "src/components/FinancialPositionPanel.tsx",
    '''          المصروفات المدفوعة لا تُخصم مرة ثانية هنا لأنها خفّضت رصيد الخزائن بالفعل؛ وهي تظل مخصومة في معادلة صافي الأرباح التشغيلية. تمويل المالك لا يدخل في صافي الأرباح.''',
    '''          رصيد تاجر الكاش الموجب يُعامل كأموال للشركة ضمن الخزائن/الأصول، بينما الرصيد السالب يُعامل كالتزام على الشركة. المصروفات المدفوعة لا تُخصم مرة ثانية هنا لأنها خفّضت رصيد الخزائن بالفعل؛ وهي تظل مخصومة في معادلة صافي الأرباح التشغيلية. تمويل المالك لا يدخل في صافي الأرباح.''',
    "financial position explanation",
)

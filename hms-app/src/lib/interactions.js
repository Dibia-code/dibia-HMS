// Starter reference only. It surfaces prompts to the pharmacist and never blocks
// dispensing. A pharmacist should review and extend this list before go-live.
const PAIRS = [
  [['warfarin'], ['diclofenac', 'ibuprofen', 'aspirin', 'naproxen'], 'Bleeding risk is raised when warfarin is taken with an NSAID or aspirin.'],
  [['tramadol'], ['fluoxetine', 'sertraline', 'amitriptyline'], 'Tramadol with an antidepressant can cause serotonin syndrome and seizures.'],
  [['sildenafil'], ['glyceryl trinitrate', 'isosorbide'], 'Sildenafil with a nitrate can cause a severe drop in blood pressure.'],
  [['ciprofloxacin'], ['theophylline'], 'Ciprofloxacin can raise theophylline to toxic levels.'],
  [['methotrexate'], ['trimethoprim', 'cotrimoxazole'], 'Methotrexate with trimethoprim raises the risk of serious blood toxicity.'],
  [['clarithromycin'], ['simvastatin', 'atorvastatin'], 'Clarithromycin raises statin levels and the risk of muscle damage.'],
  [['lisinopril', 'enalapril', 'captopril'], ['spironolactone', 'potassium'], 'An ACE inhibitor with a potassium-raising drug can cause high potassium.'],
  [['diclofenac', 'ibuprofen', 'naproxen'], ['aspirin'], 'Two NSAIDs together raise the risk of stomach bleeding.'],
]

const CLASSES = {
  penicillin: ['amoxicillin', 'ampicillin', 'flucloxacillin', 'penicillin', 'co-amoxiclav', 'piperacillin'],
  sulfa: ['cotrimoxazole', 'sulfamethoxazole', 'sulphadoxine'],
  nsaid: ['diclofenac', 'ibuprofen', 'naproxen', 'aspirin', 'ketoprofen'],
}

const norm = (s) => String(s || '').toLowerCase().trim()

export function allergyTokens(text) {
  return norm(text)
    .split(/[,;\n/]+|\band\b/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export function checkFlags({ allergies, drugs, alsoTaking = [] }) {
  const flags = []
  const generics = drugs.map((d) => ({ ...d, generic: norm(d.generic || d.name) }))

  for (const d of generics) {
    for (const token of allergyTokens(allergies)) {
      const cls = CLASSES[token]
      const direct = d.generic.includes(token) || token.includes(d.generic)
      const viaClass = cls && cls.some((m) => d.generic.includes(m))
      if (direct || viaClass) {
        flags.push({ kind: 'allergy', drug: d.name, message: `Patient has a recorded allergy to ${token}. ${d.name} may be unsafe.` })
      }
    }
  }

  const pool = [...generics.map((d) => ({ name: d.name, generic: d.generic })), ...alsoTaking.map((n) => ({ name: n, generic: norm(n), earlier: true }))]
  const seen = new Set()
  for (const [left, right, message] of PAIRS) {
    for (const a of pool) {
      for (const b of pool) {
        if (a === b) continue
        if (!left.some((m) => a.generic.includes(m)) || !right.some((m) => b.generic.includes(m))) continue
        if (a.earlier && b.earlier) continue
        const key = [a.name, b.name].sort().join('|')
        if (seen.has(key)) continue
        seen.add(key)
        const text = `${a.name} with ${b.name}: ${message}`
        for (const involved of [a, b]) {
          if (involved.earlier) continue
          const target = generics.find((g) => g.name === involved.name)
          if (target) flags.push({ kind: 'interaction', drug: target.name, message: text })
        }
      }
    }
  }
  return flags
}

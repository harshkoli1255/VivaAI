"""Calculate API/self-hosted cost per viva and cohort from explicitly supplied rates.

No current prices or unmeasured usage are invented. Null rates keep totals pending.
Run: python scripts/cost_sheet.py docs/cost-inputs.example.json --output cost-sheet.json
"""
import argparse
import json
import math
from pathlib import Path


def calculate(config):
    cohort = config.get('cohort_size', 350)
    if type(cohort) is not int or cohort < 1:
        raise ValueError('cohort_size must be a positive integer')
    currency = config.get('currency', 'USD')
    modes = {}
    for mode in ('api', 'self_hosted'):
        components = config.get(mode, [])
        rows, missing = [], []
        for component in components:
            quantity, rate = component.get('quantity_per_viva'), component.get('rate_per_unit')
            complete = quantity is not None and rate is not None and bool(component.get('rate_source')) and bool(component.get('rate_date'))
            for name, value in (('quantity_per_viva', quantity), ('rate_per_unit', rate)):
                if value is not None and (isinstance(value, bool) or not math.isfinite(float(value)) or float(value) < 0):
                    raise ValueError(f'{name} must be finite and nonnegative')
            subtotal = float(quantity) * float(rate) if complete else None
            rows.append({**component, 'cost_per_viva': subtotal})
            if not complete: missing.append(component['name'])
        per_viva = sum(row['cost_per_viva'] for row in rows) if rows and not missing else None
        modes[mode] = {'status': 'calculated_from_supplied_inputs' if per_viva is not None else 'pending_inputs',
            'cost_per_viva': round(per_viva, 6) if per_viva is not None else None,
            'cohort_cost': round(per_viva * cohort, 4) if per_viva is not None else None,
            'missing_inputs': missing, 'components': rows}
    return {'currency': currency, 'cohort_size': cohort, 'modes': modes,
            'note': 'Estimates depend on measured usage and current quoted rates; taxes and idle infrastructure must be entered explicitly.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inputs')
    parser.add_argument('--output')
    args = parser.parse_args()
    result = json.dumps(calculate(json.loads(Path(args.inputs).read_text())), indent=2, allow_nan=False)
    if args.output: Path(args.output).write_text(result + '\n')
    else: print(result)

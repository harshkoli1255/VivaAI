import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('cost_sheet', Path(__file__).parents[2] / 'scripts/cost_sheet.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_known_cost_arithmetic_and_missing_rates():
    row = {'name': 'Fixture', 'quantity_per_viva': 15, 'rate_per_unit': .01, 'rate_source': 'synthetic unit test', 'rate_date': '2026-10-21'}
    result = module.calculate({'api': [row], 'self_hosted': [{**row, 'rate_per_unit': None}]})
    assert result['modes']['api']['cost_per_viva'] == .15
    assert result['modes']['api']['cohort_cost'] == 52.5
    assert result['modes']['self_hosted']['cohort_cost'] is None
    assert result['modes']['self_hosted']['status'] == 'pending_inputs'


@pytest.mark.parametrize('value', [-1, float('nan'), float('inf'), True])
def test_bad_costs_are_rejected(value):
    with pytest.raises(ValueError):
        module.calculate({'api': [{'name': 'Fixture', 'quantity_per_viva': value, 'rate_per_unit': .01}]})

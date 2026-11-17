from datetime import date

import pytest
from pydantic import ValidationError

from optimizer.models import AvailabilityWindow, DateRange


def test_one_day_range_is_accepted():
    day = date(2026, 1, 5)
    assert DateRange(start=day, end=day).end == day


def test_range_ending_before_it_starts_is_rejected():
    with pytest.raises(ValidationError, match="End date must not be before start date"):
        DateRange(start=date(2026, 1, 5), end=date(2026, 1, 4))


def test_availability_window_ending_before_it_starts_is_rejected():
    with pytest.raises(ValidationError, match="End date must not be before start date"):
        AvailabilityWindow(start=date(2026, 1, 5), end=date(2026, 1, 4), ratio=0.5)

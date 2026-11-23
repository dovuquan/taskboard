"""Fractional positions: `between` picks a position, or says the gap is used up."""

import math

import pytest

from taskboard.ordering import Exhausted, between


def test_an_empty_board_starts_at_one():
    assert between(None, None) == 1.0


def test_after_the_last_adds_one():
    assert between(4.0, None) == 5.0


def test_before_the_first_subtracts_one():
    assert between(None, 1.0) == 0.0
    assert between(None, 0.0) == -1.0


def test_between_two_is_the_midpoint():
    assert between(1.0, 2.0) == 1.5
    assert between(1.0, 4.0) == 2.5


def test_neighbours_with_no_float_between_are_exhausted():
    with pytest.raises(Exhausted):
        between(1.0, math.nextafter(1.0, 2))


def test_equal_neighbours_are_exhausted():
    with pytest.raises(Exhausted):
        between(2.0, 2.0)

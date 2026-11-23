"""Fractional positions: `between` picks a position, or says the gap is used up."""

import math

import pytest
from sqlalchemy import select
from support import add_board, add_card, add_list, add_user, query

from taskboard.db import run_migrations
from taskboard.models import Card
from taskboard.ordering import Exhausted, between, rebalance


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


def test_card_rebalance_renumbers_only_one_list(db_url):
    run_migrations(db_url)
    boss = add_user(db_url, "boss@example.com")
    board = add_board(db_url, boss, "B")
    one = add_list(db_url, board, "One", 1.0)
    two = add_list(db_url, board, "Two", 2.0)
    a = add_card(db_url, board, one, "A", 7.5)
    b = add_card(db_url, board, one, "B", 3.5)
    c = add_card(db_url, board, one, "C", 3.5)  # same position: the id breaks the tie
    other = add_card(db_url, board, two, "Other", 9.5)

    def run(s):
        rebalance(s, Card, Card.list_id == one)
        s.commit()
        return {row_id: position for row_id, position in s.execute(select(Card.id, Card.position))}

    positions = query(db_url, run)

    assert positions == {b: 1.0, c: 2.0, a: 3.0, other: 9.5}

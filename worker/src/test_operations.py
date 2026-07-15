from operations import run_operation


def test_uppercase():
    assert run_operation("UPPERCASE", "hello") == "HELLO"


def test_lowercase():
    assert run_operation("LOWERCASE", "HELLO") == "hello"


def test_reverse_string():
    assert run_operation("REVERSE_STRING", "abc") == "cba"


def test_word_count():
    assert run_operation("WORD_COUNT", "the quick brown fox") == "4"


def test_invalid_operation():
    try:
        run_operation("NOT_REAL", "abc")
        assert False, "expected ValueError"
    except ValueError:
        pass

"""Supported AI task operations.

Kept as pure functions so they're easy to unit test and to extend with
real AI/NLP operations later without touching the queue/consumer logic.
"""


def op_uppercase(text: str) -> str:
    return text.upper()


def op_lowercase(text: str) -> str:
    return text.lower()


def op_reverse_string(text: str) -> str:
    return text[::-1]


def op_word_count(text: str) -> str:
    count = len(text.split())
    return str(count)


OPERATIONS = {
    "UPPERCASE": op_uppercase,
    "LOWERCASE": op_lowercase,
    "REVERSE_STRING": op_reverse_string,
    "WORD_COUNT": op_word_count,
}


def run_operation(operation_type: str, input_text: str) -> str:
    if operation_type not in OPERATIONS:
        raise ValueError(f"Unsupported operation type: {operation_type}")
    return OPERATIONS[operation_type](input_text)

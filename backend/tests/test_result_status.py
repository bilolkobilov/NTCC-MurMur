"""The status shown for a patient in the registry, from the latest exam (pure mapping, no database)."""

import pytest

from app.models import ExamStatus
from app.services.result_status import RegistryStatus, derive, priority_rank

S = ExamStatus


@pytest.mark.parametrize(
    ("exam_status", "kwargs", "expected"),
    [
        (None, {}, RegistryStatus("pending", False)),
        (S.WAITING, {}, RegistryStatus("pending", False)),
        (S.RECORDING, {}, RegistryStatus("pending", False)),
        (S.UPLOADED, {}, RegistryStatus("pending", False)),
        (S.FAILED, {}, RegistryStatus("failed", False)),
        (S.ANALYZED, {"ai_quality": "good", "ai_label": "absent"}, RegistryStatus("normal", True)),
        (S.ANALYZED, {"ai_quality": "good", "ai_label": "murmur"}, RegistryStatus("abnormal", True)),
        (S.ANALYZED, {"ai_quality": "bad", "ai_label": "murmur"}, RegistryStatus("pending", True)),
        (S.ANALYZED, {"ai_quality": "unknown", "ai_label": "not_analyzed"}, RegistryStatus("pending", True)),
        (S.ANALYZED, {}, RegistryStatus("pending", True)),
        (
            S.REVIEWED,
            {"ai_quality": "good", "ai_label": "absent", "doctor_agrees": True},
            RegistryStatus("normal", False),
        ),
        (
            S.REVIEWED,
            {"ai_quality": "good", "ai_label": "murmur", "doctor_agrees": True},
            RegistryStatus("abnormal", False),
        ),
        (
            S.REVIEWED,
            {"ai_quality": "good", "ai_label": "murmur", "doctor_agrees": False},
            RegistryStatus("reviewed", False),
        ),
        (
            S.REVIEWED,
            {"ai_quality": "bad", "ai_label": "murmur", "doctor_agrees": True},
            RegistryStatus("reviewed", False),
        ),
        (S.REVIEWED, {}, RegistryStatus("reviewed", False)),
    ],
)
def test_status_for_every_latest_exam_state(exam_status, kwargs, expected):
    assert derive(exam_status, **kwargs) == expected


def test_priority_puts_abnormal_to_review_first_and_normal_last():
    order = [
        RegistryStatus("abnormal", True),
        RegistryStatus("failed", False),
        RegistryStatus("normal", True),
        RegistryStatus("pending", False),
        RegistryStatus("normal", False),
        RegistryStatus("reviewed", False),
    ]
    ranks = [priority_rank(s) for s in order]
    assert ranks == sorted(ranks)

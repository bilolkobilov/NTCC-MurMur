"""What the patient registry shows for a patient: one status taken from their latest exam.

Pure functions, no database. The AI vocabulary stays in `analyzer.gave_answer()`. The model gives a yes/no answer only,
so there is no "borderline" or "critical" here: that would be invented.
"""

from dataclasses import dataclass
from typing import Literal

from app.models import ExamStatus
from app.services.analyzer import gave_answer

ResultStatus = Literal["normal", "abnormal", "pending", "failed", "reviewed"]


@dataclass(frozen=True)
class RegistryStatus:
    result_status: ResultStatus
    needs_review: bool  # the latest exam is analyzed and waits for the doctor


def derive(
    exam_status: ExamStatus | None,
    *,
    ai_quality: str | None = None,
    ai_label: str | None = None,
    doctor_agrees: bool | None = None,
) -> RegistryStatus:
    """`exam_status` is None for a patient with no exam yet."""
    if exam_status is None or exam_status in (ExamStatus.WAITING, ExamStatus.RECORDING, ExamStatus.UPLOADED):
        return RegistryStatus("pending", False)
    if exam_status == ExamStatus.FAILED:
        return RegistryStatus("failed", False)

    answered = ai_quality is not None and ai_label is not None and gave_answer(ai_quality, ai_label)
    answer: ResultStatus = "abnormal" if ai_label == "murmur" else "normal"
    if exam_status == ExamStatus.ANALYZED:
        return RegistryStatus(answer if answered else "pending", True)
    # reviewed: the AI answer counts only if the doctor agreed; the doctor's own finding is not stored
    if answered and doctor_agrees:
        return RegistryStatus(answer, False)
    return RegistryStatus("reviewed", False)


def priority_rank(status: RegistryStatus) -> int:
    """Lower = more urgent: abnormal to review, failed, other to review, pending, normal, reviewed."""
    if status.needs_review and status.result_status == "abnormal":
        return 0
    if status.result_status == "failed":
        return 1
    if status.needs_review:
        return 2
    return {"pending": 3, "normal": 4}.get(status.result_status, 5)

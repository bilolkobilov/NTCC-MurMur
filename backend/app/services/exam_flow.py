"""The only place where an exam's status changes.

    waiting → recording → uploaded → analyzed → reviewed
       └──────────┴───────────┴──→ failed

waiting:   doctor created the exam; a `record` command waits for the device
recording: the device picked up the command
uploaded:  the WAV arrived; analysis runs in the background
analyzed:  the analyzer stored an AI result
reviewed:  the doctor added a note and agreed/disagreed with the AI (final; the patient can see it now)
failed:    something went wrong; `failure_reason` says what
"""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import AuscultationPoint, Device, Exam, ExamStatus, Patient, User
from app.models.device_command import DeviceCommand
from app.services.errors import BadRequest, Conflict

RECORD_SECONDS = 20

ALLOWED: dict[ExamStatus, set[ExamStatus]] = {
    ExamStatus.WAITING: {ExamStatus.RECORDING, ExamStatus.FAILED},
    ExamStatus.RECORDING: {ExamStatus.UPLOADED, ExamStatus.FAILED},
    ExamStatus.UPLOADED: {ExamStatus.ANALYZED, ExamStatus.FAILED},
    ExamStatus.ANALYZED: {ExamStatus.REVIEWED},
    ExamStatus.REVIEWED: set(),
    ExamStatus.FAILED: set(),
}


def _move(exam: Exam, to: ExamStatus) -> None:
    if to not in ALLOWED[exam.status]:
        raise Conflict(f"exam is '{exam.status.value}', cannot become '{to.value}'")
    exam.status = to


def create_exam(db: Session, doctor: User, patient: Patient, device: Device, point: AuscultationPoint) -> Exam:
    """Caller has already checked that the patient and the device belong to this doctor."""
    if patient.consent_given_at is None:
        raise BadRequest("patient consent is not recorded")
    exam = Exam(patient_id=patient.id, doctor_id=doctor.id, device_id=device.id, point=point)
    db.add(exam)
    db.flush()
    db.add(DeviceCommand(device_id=device.id, exam_id=exam.id, command="record", duration_s=RECORD_SECONDS))
    db.commit()
    return exam


def mark_recording(exam: Exam) -> None:
    _move(exam, ExamStatus.RECORDING)


def mark_uploaded(exam: Exam) -> None:
    _move(exam, ExamStatus.UPLOADED)


def mark_analyzed(exam: Exam) -> None:
    _move(exam, ExamStatus.ANALYZED)


def mark_failed(exam: Exam, reason: str) -> None:
    _move(exam, ExamStatus.FAILED)
    exam.failure_reason = reason[:500]


def review(db: Session, exam: Exam, note: str, agrees_with_ai: bool) -> Exam:
    _move(exam, ExamStatus.REVIEWED)
    exam.doctor_note = note
    exam.doctor_agrees_with_ai = agrees_with_ai
    exam.reviewed_at = datetime.now(UTC)
    db.commit()
    return exam

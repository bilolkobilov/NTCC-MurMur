"""The only place where an exam's status changes.

    waiting → recording → uploaded → analyzed → reviewed
       └──────────┴───────────┴──→ failed

waiting:   doctor created the exam; a `record` command waits for the device
recording: the device picked up the command
uploaded:  the WAV arrived; analysis runs in the background
analyzed:  the analyzer stored an AI result
reviewed:  the doctor added a note (+ agree/disagree, if the AI gave an answer); final, the patient sees it
failed:    something went wrong, or the doctor cancelled a waiting/recording exam; `failure_reason` says what
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuscultationPoint, CommandStatus, Device, Exam, ExamStatus, Patient, User
from app.models.device_command import DeviceCommand
from app.services.analyzer import gave_answer
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


CANCELLABLE = {ExamStatus.WAITING, ExamStatus.RECORDING}


def cancel(db: Session, exam: Exam) -> Exam:
    """Doctor stops an exam that never got its recording (e.g. the device went offline). Caller holds a row lock.

    Its device command is closed; a late upload for it gets 409, which the device treats as "done".
    """
    if exam.status not in CANCELLABLE:
        raise Conflict(f"exam is '{exam.status.value}', only waiting or recording exams can be cancelled")
    mark_failed(exam, "cancelled by doctor")
    now = datetime.now(UTC)
    for command in db.scalars(
        select(DeviceCommand).where(
            DeviceCommand.exam_id == exam.id, DeviceCommand.status.in_([CommandStatus.PENDING, CommandStatus.TAKEN])
        )
    ):
        command.status = CommandStatus.DONE
        command.done_at = now
    db.commit()
    return exam


def review(db: Session, exam: Exam, note: str, agrees_with_ai: bool | None) -> Exam:
    """`agrees_with_ai` is required when the AI gave an answer, and must be empty when it gave none (owner)."""
    if exam.status == ExamStatus.ANALYZED:  # other statuses get their 409 from _move below
        ai = exam.ai_result
        answered = ai is not None and gave_answer(ai.quality, ai.label)
        if answered and agrees_with_ai is None:
            raise BadRequest("say whether you agree with the AI")
        if not answered and agrees_with_ai is not None:
            raise BadRequest("the AI gave no answer to agree with")
    _move(exam, ExamStatus.REVIEWED)
    exam.doctor_note = note
    exam.doctor_agrees_with_ai = agrees_with_ai
    exam.reviewed_at = datetime.now(UTC)
    db.commit()
    return exam

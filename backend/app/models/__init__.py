"""All models, imported here so `Base.metadata` (and Alembic) sees every table."""

from app.models.ai_result import AIResult
from app.models.audit_log import AuditLog
from app.models.device import Device
from app.models.device_command import DeviceCommand
from app.models.enums import AuscultationPoint, CommandStatus, ExamStatus, Role, Sex
from app.models.exam import Exam
from app.models.patient import Patient
from app.models.recording import Recording
from app.models.user import User
from app.models.vitals import VitalSigns

__all__ = [
    "AIResult",
    "AuditLog",
    "AuscultationPoint",
    "CommandStatus",
    "Device",
    "DeviceCommand",
    "Exam",
    "ExamStatus",
    "Patient",
    "Recording",
    "Role",
    "Sex",
    "User",
    "VitalSigns",
]

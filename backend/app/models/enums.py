"""Fixed value sets. Stored as short strings with a CHECK constraint (no native PG enums: simpler migrations)."""

from enum import StrEnum

from sqlalchemy import Enum


class Role(StrEnum):
    ADMIN = "admin"
    DOCTOR = "doctor"
    PATIENT = "patient"


class Sex(StrEnum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"


class AuscultationPoint(StrEnum):
    AV = "AV"  # aortic
    PV = "PV"  # pulmonic
    TV = "TV"  # tricuspid
    MV = "MV"  # mitral


class ExamStatus(StrEnum):
    WAITING = "waiting"
    RECORDING = "recording"
    UPLOADED = "uploaded"
    ANALYZED = "analyzed"
    REVIEWED = "reviewed"
    FAILED = "failed"


class CommandStatus(StrEnum):
    PENDING = "pending"
    TAKEN = "taken"
    DONE = "done"


def str_enum(enum_cls: type[StrEnum], name: str) -> Enum:
    """Column type for a StrEnum: VARCHAR + CHECK constraint, values stored as the enum's string value."""
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=max(len(member.value) for member in enum_cls),
        values_callable=lambda cls: [member.value for member in cls],
    )

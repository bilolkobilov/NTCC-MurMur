"""Business errors raised by services. `app/main.py` turns them into HTTP responses, so services stay HTTP-free."""


class ServiceError(Exception):
    status_code = 400

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class BadRequest(ServiceError):
    status_code = 400


class NotFound(ServiceError):
    """Also used when the object exists but belongs to someone else, so ids of others are not revealed."""

    status_code = 404


class Conflict(ServiceError):
    status_code = 409

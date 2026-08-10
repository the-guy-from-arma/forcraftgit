from __future__ import annotations


STATE_OF_EMERGENCY_INCIDENT = "server_reset"


def insurance_claim_filing_error(state_of_emergency: bool, incident_type: str) -> str | None:
    """Return the resident-facing reason a new insurance claim cannot be filed."""
    normalized_incident = str(incident_type or "").strip().lower()
    if state_of_emergency and normalized_incident != STATE_OF_EMERGENCY_INCIDENT:
        return (
            "Only State of Emergency continuity claims may be filed while the "
            "emergency declaration is active."
        )
    if not state_of_emergency and normalized_incident == STATE_OF_EMERGENCY_INCIDENT:
        return "State of Emergency claim filing closed when the declaration was lifted."
    return None

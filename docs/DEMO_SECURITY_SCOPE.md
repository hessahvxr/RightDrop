# Sign-up, roles and patient linking: what this demo version protects

RightDrop is currently a hackathon prototype for use with **demo accounts and synthetic data only**.
Sign-up is deliberately simple. This page records what is enforced and what is knowingly left open.

## How it works

- **Sign-up:** a patient or a doctor registers with name, email and password and is taken straight into
  their area. There is no approval step, invitation code or licence check.
- **Role:** chosen by the registration page used (patient or doctor). The server copies it into the
  account's signed app metadata at sign-up; the user cannot change it afterwards.
- **Linking:** the patient shows their code (profile page) to the doctor, who types it in. A correct code
  connects them at once. Handing over the code is the patient's consent.

## Enforced (on the server, not only in the interface)

| Rule | Where |
| --- | --- |
| A patient account cannot use the doctor link function, create connections, prescribe, or change its role | database (RLS, grants, `connect_patient_by_code`) |
| A doctor cannot read a patient, prescribe or receive summaries without a connection | database (RLS) |
| The doctor area never renders for a patient account, or the reverse, not even while the session loads | `ProtectedRoute`, `AuthContext` |
| New patient codes: `RD-XXXX-XXXX-XXXX`, 60 random bits | `generate_patient_code()` |
| At most 10 wrong codes per hour and 30 per day per doctor account; while locked even a correct code is refused | `connect_patient_by_code` + `link_code_attempts` |
| A wrong code returns nothing about any patient | `connect_patient_by_code` |

## Knowingly NOT protected in the demo version

- **Anyone can register as a doctor.** There is no verification of doctors. A person who is given a
  patient's code can connect, read that patient's details and write prescriptions.
- **No separate patient approval** of each connection.
- **Accounts created before this change keep their short code** (`RD-` + 6 characters). Those codes are
  protected only by the attempt limit, which is per doctor account and can be multiplied by registering
  many accounts.
- Email confirmation, password strength and multi-factor sign-in are unchanged (see the security review).

## Before any use with real patients

1. Verify doctors before their accounts gain doctor rights.
2. Require the patient's explicit approval of each connection.
3. Replace all remaining short codes with long ones.
4. Complete the other mandatory items of the security review (deployment order of migrations, AI data
   handling, cost limits, forcing Arabic replies).

# SMS OTP Integration

This backend can optionally send password-reset OTP codes via SMS using the [Yoola SMS](https://yoolasms.com) API. The integration is disabled by default and only activates when the required environment variables are present.

## Environment Variables

Add the following entries to your backend environment configuration (e.g., `.env` on the server):

```
# Yoola SMS configuration
YOOLA_SMS_API_KEY=your_api_key_here
# Optional overrides
YOOLA_SMS_API_URL=https://yoolasms.com/api/v1/send
YOOLA_SMS_DEFAULT_COUNTRY_CODE=256
YOOLA_SMS_OTP_TEMPLATE=Your OTP code is {OTP}. It expires in 15 minutes.
```

- `YOOLA_SMS_API_KEY` (required): API key from your Yoola dashboard.
- `YOOLA_SMS_API_URL` (optional): Override the base URL if the provider supplies an alternative endpoint.
- `YOOLA_SMS_DEFAULT_COUNTRY_CODE` (optional): Numeric country code (without `+`) used to normalise local numbers that start with `0` or contain only digits.
- `YOOLA_SMS_OTP_TEMPLATE` (optional): Message template. The placeholder `{OTP}` is replaced with the generated code.

### Phone Number Resolution

When an OTP is generated:

1. The system looks for phone numbers tied to the user in these locations (in order):
   - `users.username`
   - `students.phone_number`, `students.guardian_phone`
   - `student_profiles.phone`, `student_profiles.whatsapp` (only if the table exists)
2. Numbers are normalised—whitespace, brackets, and hyphens are removed, leading `0` is replaced with `+<country_code>`, and duplicates are dropped.
3. If no numbers remain after normalisation, the backend falls back to email only and logs a warning.

### Behaviour

- SMS delivery is attempted only for password-reset OTPs.
- Failures to send SMS do **not** block the password-reset flow; the backend logs the error and continues.
- OTPs are still sent by email, so SMS acts as a supplement.

## Testing

After configuring the environment variables, restart the backend and trigger a password-reset request. Monitor the logs for `[SmsService]` entries to confirm SMS attempts and responses.





























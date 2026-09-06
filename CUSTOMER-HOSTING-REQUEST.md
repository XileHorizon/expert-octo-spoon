# Customer hosting information request

Use this as a call/email checklist. Do not ask the customer to send passwords.

> To prepare the quote-form launch safely, I need to confirm what your current hosting account supports. Please send the exact hosting provider and plan/product name, plus a screenshot of the main hosting dashboard with private account details hidden. If the provider supports delegated users, please invite me as a temporary administrator rather than sharing your password.
>
> I need to confirm:
>
> - whether the plan runs persistent Node.js applications and which Node versions are available;
> - whether it provides MySQL 8.0 or 8.4;
> - whether it supports private application environment variables;
> - the maximum web request/upload size and request timeout;
> - whether outbound SMTP or HTTPS email delivery is allowed;
> - whether it provides application logs, restart controls, scheduled jobs, database backups/restores, custom domains, and SSL;
> - which domain or subdomain you want to use for the quote form;
> - which email address should receive quote submissions;
> - which authorized address should send notifications;
> - which email address should own the private administration portal.
>
> Please do not send passwords, database credentials, API keys, or email passwords by email or chat. We can use delegated access or enter required secrets directly into the hosting provider's protected settings together.

Record the answers in the qualification section of `DEPLOYMENT-HANDBOOK.md` before choosing the production host or changing DNS.
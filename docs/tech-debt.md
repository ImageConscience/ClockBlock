# Follow-up Technical Tasks

These items are outside the scope of the current deployment but worth capturing for future sprints.

- **Break down `app/services/block-scheduler.server.js`.**
  - Extract metaobject helpers (definition ensure, field builders) into `app/services/metaobjects.server.js`.
  - Split upload helpers into a dedicated module with unit tests around the staged upload flow.
- **Add automated tests.**
  - Unit-test the `ensureActiveSubscription` billing helper with mocked GraphQL responses.
  - Add an integration test that covers loader/action happy paths (e.g., using React Router’s data APIs or Playwright component tests).
- **Improve observability.**
  - Replace ad-hoc debug logging with a structured logger (e.g., pino) backed by an env-driven log level.
  - Forward webhook execution metrics to a dashboard (duration, success/failure).
- **Theme extension hardening.**
  - Consider adding visual regression tests (Storybook/Chromatic) for the scheduled banner block.
  - Document recommended image sizes and responsive behaviour in the extension schema or README.
- **Deployment hygiene.**
  - Automate the Railway deploy (GitHub Actions) with lint/build/test steps.
  - Track required env vars/secrets in a single `.env.example` file for onboarding.

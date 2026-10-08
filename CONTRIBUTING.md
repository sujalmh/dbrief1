# Contributing to Dbrief1

Thanks for helping out. This guide covers the setup and workflow conventions so pull requests stay easy to review. Since `main` is branch-protected, every change lands through a reviewed pull request.

## Setup

```bash
# Web app
cd main
npm install
cp env.example .env.local   # fill in keys, never commit this file
npm run dev                 # http://localhost:3000

# Data service (separate terminal)
cd ../api
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000
```

The chart gallery at http://localhost:3000/viz renders without sign-in and is the fastest way to check visualization changes visually.

## Workflow

1. Create a focused branch from `main` with a descriptive name.
2. Keep each pull request to one concern so it can be reviewed in one sitting.
3. Run the checks below before requesting review. `main` requires one approving review, and stale reviews are dismissed when new commits land.
4. Write a clear description that explains what changed and how it was verified (tests, screenshots, or both for UI work).

## Checks that must pass

```bash
cd main
npm test            # full unit suite (vitest)
npm run lint        # eslint, zero errors
npx tsc --noEmit    # typecheck, zero errors
```

`__tests__/unit/planner.test.ts` is excluded from the default run because it calls a live model. Anything that touches chat rendering should also add or update a unit test, and anything user-visible deserves a screenshot in the pull request.

## House style

- Write flowing sentences in all user-facing copy, including docs, comments that users read, and commit messages. Never use staccato fragments.
- Never use emojis anywhere in the app or docs.
- Never use em dashes in generated answers or user-facing copy. Use a plain hyphen or restructure the sentence.
- Prefer editing existing files over creating new ones, and pure, testable helpers over logic buried in components.

## Secrets

Never commit API keys, OAuth secrets, tokens, or `.env.local`. Report a leaked credential privately following [SECURITY.md](.github/SECURITY.md) instead of opening a public issue.

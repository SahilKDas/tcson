# Security policy

## Supported versions

Security fixes are provided for the latest stable major release. During the v1 prerelease cycle,
the newest published prerelease is supported.

## Trust boundary

TcSON evaluates TypeScript as executable configuration. Use it only with configuration that is
trusted and source-controlled alongside the consuming project.

TcSON removes common host bindings and disables VM string and WebAssembly code generation, but
these are defense-in-depth measures against accidental ambient access. TcSON is not a
malicious-code sandbox, does not claim process isolation, and must not be used to evaluate
untrusted uploads, remote input, package contents, or adversarial source.

For untrusted input, use a non-executable data format and validate it against an application-owned
schema.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the repository's
[private vulnerability reporting](https://github.com/SahilKDas/tcson/security/advisories/new)
form. Include affected versions, runtime and operating system, impact, reproduction steps, and any
known mitigations.

You should receive an acknowledgement within five business days. Coordinated disclosure timing
will be agreed after the report is reproduced and assessed.

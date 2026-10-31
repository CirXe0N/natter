# The project is called Natter, not nats-ui

The product, repository, Go module, binary and any domain are named **Natter** and describe themselves as "a UI for NATS™". The working name `nats-ui` was dropped because the Linux Foundation, which holds the NATS mark, says a trademark "should not be used as part of your product name", should not be "hyphenated", and should not appear in a domain name, while "<your product name> for <mark>" is the allowed form ([LF Trademark Usage Guidelines](https://www.linuxfoundation.org/legal/trademark-usage); NATS is listed as NATS™ in the [LF trademark list](https://www.linuxfoundation.org/trademark-list/), and Synadia agreed in May 2025 to assign its NATS registrations to the Linux Foundation, [CNCF](https://www.cncf.io/blog/2025/05/01/cncf-and-synadia-align-on-securing-the-future-of-the-nats-io-project/)).

## Consequences

- Docs and marketing text put ™ after the first mention of NATS and carry a trademark notice; the NATS logo is not used in Natter's own logo or app icon.
- `nats-ui` survives only as the name of the local working directory and in dated research records.
- Whether "Natter" is too close to "NATS" was not confirmed with the Linux Foundation (trademarks@linuxfoundation.org); ask before a public release if in doubt.

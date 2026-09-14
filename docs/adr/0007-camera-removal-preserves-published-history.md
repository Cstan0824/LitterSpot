# ADR 0007: Camera removal preserves published history

Status: accepted

Root removes a published Camera by ending its active lifecycle and publishing a new Site Map revision without its placement. The system retains Camera identity, source and Registration revisions, evidence, Alerts, Work, and audit events because hard deletion would break operational history; reintroducing the physical device requires a new Camera identity and Registration.

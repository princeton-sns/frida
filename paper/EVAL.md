# Evaluation Notes

## Expressiveness

Properties of various app-categories (with app examples) that Frida showcases/enables.

| Category | Sharing Circle Size | Sharing Privileges | Client-side Computation | External Server | Group structure | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| A | Small | R | Lo | No | Standard | Want to show that the privacy reqs for disjoint users (those that largely don't share data) are the same as those for users that do share data. |
| B | Small | R | Lo | Yes | Standard |  |
| C | Small | RWA | Lo | No | Standard | Maybe not necessary/useful if already have category w larger sharing circles that requires the same sharing privs (larger sharing circles are a superset of smaller sharing circles, and RWA privs are a superset of R privs). |
| D | Large | R | Lo | No | Standard |  |
| E | Large | RWA | Lo | No | Standard |  |
| F | Large | RWA | Lo | Yes | Standard |  |
| G | Large | RWA | Lo | No | Non-standard |  |
| H | Any | Any | Hi | No | Standard |  |
| I | Any | Any | Hi | Yes | Standard |  |

No app examples (yet) for Category C. Frida "edge" refers to an app that violates one of the following constraints for an ideal Frida app:
1. Fully user-generated data (see: B1, E1)
1. Small sharing circles (see: D1)
1. Amount of data stored fits on a single device (see: E1, F1)
1. [NEW] Computational requirements are modest (see: H1, I1)

| Category | ID | Example App | Notes |
| --- | --- | --- | --- |
| A | 1 | Period tracking |  |
| A | 2 | Fitness tracking |  |
| A | 3 | Note taking |  |
| A | 4 | Personal finance tracking |  |
| A | 5 | Medical tracking/communcation |  |
| B | 1 | Anonymous payment | Could exercise Frida "edge" if use external server/proxy to obfuscate data access patterns to banks (although obfuscating data access patterns is an orthogonal problem). |
| D | 1 | Social media | Could exercise Frida "edge" if sharing circles are exceptionally large. |
| E | 1 | Book club | Could exercise Frida "edge" if use external server/proxy to obfuscate data access patterns to book database (although obfuscating data access patterns is an orthogonal problem) or to store local copy of book database on a trusted machine. |
| E | 2 | Todo list |  |
| E | 3 | Calendar app |  |
| E | 4 | Augmented Signal | Possibilities: enable groups of devices (e.g. Group -> User -> Device Groups -> Devices instead of Group -> User -> Devices); allow users to specify less "safe" devices (e.g. a shared computer) that should be omitted when added to an especially privacy-sensitive group (e.g. Group -> Users + Devices). |
| E | 5 | Collaborative text editing | OT-style consistency/conflict resolution requires that the operations that Frida typically supports are essentially broken down into more fine-grained sub-ops within each op. Fortunately, OT relies on establishing a total order across all operations, which maps onto Frida quite smoothly. In other words, the OT-algorithm can be implemented in such a way that Frida easily enforced is. A kind of interesting way to frame Frida is that we generalize the OT-mechanism to non-OT-style apps. |
| F | 1 | Photo sharing | Some data may be read-only (the actual photos) while other data may be mutable (creating albums, adding devices to be able to view/add photos to albums, adding photos to albums, etc). Could exercise Frida "edge" if use trusted, external machine to store any data that doesn't fit on device. |
| G | 1 | Embedded/IoT | Devices exist outside of the canonical "linked" group. May have some similarities with the "Augmented Signal" app. |
| H | 1 | Recommender systems | Could exercise Frida "edge" in terms of client-side computational requirements if ML is only running on single-"user"'s data. |
| I | 1 | Recommender systems | Could exercise Frida "edge" in terms of an extended Frida design with an external server if ML is running on aggregate data. |

## Performance

# Paper Notes

## 8/31/22

### Criticism of intro as it stands

We do not mention/motivate why we are moving
things from the server to the client. We kind of allude to it by saying that modern apps
are built to fully trust the server, hence a change of architecture is necessary to not 
fully trust the server anymore.

I'm thinking if it's fine to not even mentioned the change-of-architecture stuff in 
the intro, but we'd probably at least need to have one sentence that says something
like: framework leverages a client-centric design... thus it has these device/app 
limitations.

Could also potentially address attack surface stuff. 

### What problem are we solving?

Ultimately, problem is two-fold: app devs need to be experts in privacy (reason for a 
framework), but also applications themselves need to be build in such a way that they
don't need to fully trust the central server (reason for arch change).

The question I think we need to answer (if not for ourselves then at least for 
reviews/other people) in order to better motivate changing the architure 
is: why can't we just build a framework that handles all privacy stuff without
changing the architecture?

There is a hole in our argument in-between these two ideas: 
"Making the current application architecture private is _fundamentally_ impossible"
and
"Making the current application architecture private is _practically_ impossible"

The former motivates this architecture change, but the latter does not. 

### Why can't we just harden the current architecture?

How would we build a framework that makes the current application architecture private?
(This wouldn't need to be in the intro but could instead preface the bulk of our design
section). I.e. what is the naive approach? (e.g. build up reasoning for client-centric
design).

The things we'd need to address are: 

#### Storing ground truth data

#### Identity authentication/management

#### Access control

#### Consistency

#### Conflict resolution

#### Application logic

After looking at this list, it seems like securing the current architecture
would probably require a lot of sandboxing, encrypting, and distribution. 
Different components would need to be isolated, encryption keys would need to be
elsewhere...

TODO keep thinking about this.

### How to motivate the particular apps we are targetting

Specifically, the apps that fit our "constraints":
1. user-generated data
2. data fits on single device
3. smallish sharing circles

Since these constraints can be seen as a byproduct of the solution, how do we 
build up this application space without making it seem like the kinds of applications we 
solve this problem for are merely a reflection of the limitations of our framework?

One way would be to somehow say that people tend to want these applications to be
private (via the first sentence or so in our intro). But this seems like it would
require some sort of literature survey or whatever, e.g. not fun. 

Another way would be to "start from the ground up" e.g., we've barely succeeded in 
making any applications private so we should start with those that are perhaps 
"easiest"? But this argument probably isn't doing us any favors. 

A third way would be to somehow say that the category of apps we target turns out
to be the largest category of apps. But again, this would require some sort of 
survey of apps, which may not be worth it.

A fourth way would be to focus on apps where most of the data involved is user-
generated from the get-go. A lot of attention has been paid to instant messaging
for this reason, but there are many more apps that have similar privacy 
considerations and have not gotten the same amount of attention (perhaps because,
individually, these apps do not comprise a large-enough portion of apps to 
warrant this attention, unlike messaging which is very common). However, 
together, we argue that these applications are just as important to make private 
as instant messaging. And then here maybe insert citations that show that these 
kinds of apps do actually want privacy (if we can find sources, don't think this 
is seminal to the argument).

This motivation is also probably not _that_ important, and it may just be sufficient 
to go about it the way we've been going about it.

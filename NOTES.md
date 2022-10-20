# Notes

## 9/1/22

Server is oblivious to groups.

How agnostic should the clients be to the group-type(s) structure?

As agnostic as possible, presumably, but how to do this?? But also, why does
the client need to be group agnostic? (first question). And then second, is
how?

## 9/7/22

Current group structure: 

key = ID

value = {
  name: name ? null,
  type: DEVICE_TYPE || PUBKEY_TYPE,
  members: [groupIDs] if type == DEVICE_TYPE else [pubkeys],
}

necessary field: members-type thing

is it reasonable, if an application wants to use a different group structure,
for it to implement the below functions/"methods"?

also, how to validate these custom methods, e.g. number of arguments they take 
(such that the rest of the library knows how to call them)

### Group-agnostic client requirements

getMembers(id)
- gets relevant `members`-type field of group object with id=id

resolveIDs([ids]) -> pubkeys

[HELP]
createGroup(fields)
- caller needs to know what the fields are
- called by: initDevice, createDevice, processRequestLink

addGroupMember(groupID, memberID)
- used when another device wants to link to this device, and the linked group is already created on this device

getLinkedDevices()
- used so app can easily view linked devices

### Current implementation

getMembers(id)
- gets `members` field of group object with id=id

resolveIDs([ids]) -> pubkeys
- in resolveIDs(), checks against group TYPE to determine base case
- could potentially also have the base case be an empty members list
- but this still imposes a restriction on how groups are structured

createGroup(fields)
- creates the group object (field key -> value mappings)
- calls localStorage.set(ID, group object)

addGroupMember(groupID, memberID)
- appends memberID (assumed to be the ID of another existing group or a public key, depending on the type + given the current group structure) to the members list of groupID's group value

getLinkedDevices()
- used as alias for getMembers(LINKED) so app can just call this simple func
- also does null-group error checking

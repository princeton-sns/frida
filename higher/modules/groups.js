/*
 **************
 **************
 *** Groups ***
 **************
 **************
 */
// TODO: reorganize
// TODO: clean comments
// TODO: make sure permissions module knows how to check permissions of groups? as in, if you're in the group you can modify it
import { LocalStorageWrapper } from "../db/localStorageWrapper.js";
/* doubly-linked tree, allows cycles */
const NAME = "name";
const CONTACT_LEVEL = "contactLevel";
const PARENTS = "parents";
const CHILDREN = "children";
export class Group {
    id;
    name;
    contactLevel;
    parents;
    children;
    constructor(id, name, contactLevel, parents, children) {
        this.id = id;
        this.name = name;
        this.contactLevel = contactLevel;
        this.parents = parents;
        this.children = children;
    }
}
export class Groups {
    // MAYBE: declare module class that groups can inherit 
    // that would require a prefix and storage wrapper, or 
    // perhaps make storage wrapper declaration include prefix
    static PREFIX = "__group";
    // this needs to use higher set/get data and treated as a data object
    static #storageWrapper = new LocalStorageWrapper();
    static devicesListPrefix = "__deviceList";
    /**
     * Allow groups to work on multiple storage types
     * @param storage
     */
    constructor() { }
    //FIX: overloading of the term
    static getKey(group) {
        return Groups.PREFIX + "/" + group + "/";
    }
    /**
     * Group getter.
     *
     * @param {string} groupID ID of group to get
     * @returns {Object}
     *
     */
    static #getGroup(groupID) {
        return this.#storageWrapper.get(this.getKey(groupID));
    }
    /**
     * Group setter.
     *
     * @param {string} groupID ID of group to set
     * @param {Object} groupValue value to set group to
     *
     * @private
     */
    static #setGroup(groupID, groupValue) {
        this.#storageWrapper.set(this.getKey(groupID), groupValue);
    }
    /**
    * Helper function for determining if resolveIDs has hit it's base case or not.
    *
    * @param {Object} group a group
    * @returns {boolean}
    *
    * @private
    */
    static #isDevice(group) {
        if (group.children) {
            return false;
        }
        return true;
    }
    /**
     * Create new group from list of ids
     * @param {string[]} ids group Ids to include in group
     * @return {string} group id of the newly created group
     */
    static newDevice(deviceId, name, parent) {
        let newGroup = new Group(deviceId, name, false, [], [parent]);
        // maybe have key indicate "groups/device/-...."
        // so easier to get all devices
        this.#setGroup(deviceId, newGroup);
        return deviceId;
    }
    /**
     * Delete group from list of ids
     * @param {string[]} ids group Ids to include in group
     * @return {string} group id of the newly created group
     */
    static deleteDevice(deviceId) {
        let delDevice = this.#getGroup(deviceId);
        for (let p in delDevice.parents) {
            let parentGroup = this.#getGroup(p);
            let newChildren = [];
            for (let c in parentGroup.children) {
                if (c != deviceId) {
                    newChildren.push(c);
                }
            }
            parentGroup.children = newChildren;
            this.#setGroup(p, parentGroup);
        }
        return deviceId;
    }
    /**
     * Randomly generates a new group ID.
     *
     * @returns {string}
     *
     * @private
     */
    static #generateNewGroupId() {
        return crypto.randomUUID();
    }
    /**
     * Create new group from list of ids
     * @param {string[]} ids group Ids to include in group
     * @return {string} group id of the newly created group
     */
    static newGroup(name, contactLevel, ids) {
        let newGroupId = this.#generateNewGroupId();
        let newGroup = new Group(newGroupId, name, contactLevel, [], ids);
        for (let id in ids) {
            let child = this.#getGroup(id);
            let p = child.parents ?? [];
            child.parents = p.concat(newGroupId);
            this.#setGroup(id, child);
        }
        this.#setGroup(newGroupId, newGroup);
        return newGroupId;
    }
    /**
     * Create new group from list of ids
     * @param {string[]} ids group Ids to include in group
     * @return {string} group id of the newly created group
     */
    static importGroup(groupId, group) {
        this.#setGroup(groupId, group);
        return groupId;
    }
    /**
     * Add groups in the ids list to the group
     * @param {string} group id of group to add ids to
     * @param {string[]}  ids list of ideas to add to group
     * @returns {string} group id
     */
    static addToGroup(groupId, ids) {
        let group = this.#getGroup(groupId);
        group.children = group.children?.concat(ids);
        for (let id in ids) {
            let child = this.#getGroup(id);
            let p = child.parents ?? [];
            child.parents = p.concat(ids);
            this.#setGroup(id, child);
        }
        this.#setGroup(groupId, group);
        return groupId;
    }
    /**
     * Remove groups in the ids list to the group
     * @param {string} group id of group to add ids to
     * @param {string[]}  ids list of ideas to add to group
     * @returns {string} group id
     */
    static removeFromGroup(groupId, removeId) {
        let group = this.#getGroup(groupId);
        let newChildren = [];
        for (let c in group.children) {
            if (removeId != c) {
                newChildren.push(c);
            }
        }
        let removedGroup = this.#getGroup(removeId);
        let newParents = [];
        for (let p in removedGroup.parents) {
            if (p != groupId) {
                newParents.push(p);
            }
        }
        removedGroup.parents = newParents;
        this.#setGroup(groupId, group);
        this.#setGroup(removeId, removedGroup);
        return groupId;
    }
    /**
     * Helper function for updating the specified list of an existing group.
     *
     * @param {string} key list key
     * @param {string} groupID ID of group to modify
     * @param {string} memberID ID of list member to add/remove
     * @param {callback} callback operation to perform on the list
     * @returns {Object}
     *
     * @private
     */
    static updateGroupField(key, groupID, memberID, callback) {
        let oldGroupValue = this.#getGroup(groupID);
        let newList = callback(memberID, oldGroupValue[key]);
        let newGroupValue = { ...oldGroupValue, [key]: newList };
        this.#setGroup(groupID, newGroupValue);
        return newGroupValue;
    }
    /**
     * Group remover.
     *
     * @param {string} groupID ID of group to remove
     *
     * @private
     */
    static removeGroup(groupID) {
        this.#storageWrapper.remove(this.getKey(groupID));
        let removedGroup = this.#getGroup(groupID);
        for (let p in removedGroup.parents) {
            let parentGroup = this.#getGroup(p);
            let newChildren = [];
            for (let c in parentGroup.children) {
                if (c != groupID) {
                    newChildren.push(c);
                }
            }
            parentGroup.children = newChildren;
            this.#setGroup(p, parentGroup);
        }
    }
    static getGroupName(groupID) {
        return this.#storageWrapper.get(this.getKey(groupID)).name;
    }
    static getDevices(group) {
        if (typeof group === 'string') {
            return this.#resolveIDs([group]);
        }
        else {
            return this.#resolveIDs(group);
        }
    }
    /**
     * Resolves a list of one or more group IDs to a list of public keys.
     *
     * @param {string[]} ids group IDs to resolve
     * @return {string[]}
     *
     */
    static #resolveIDs(ids) {
        let idkeys = [];
        ids.forEach((id) => {
            let group = this.#getGroup(id);
            if (group !== null) {
                if (!group.children) {
                    idkeys.push(id);
                }
                else {
                    idkeys = idkeys.concat(this.#resolveIDs(group.children));
                }
            }
        });
        return idkeys;
    }
    /**
      * Helper function that replaces (in place) the specified ID in the specified
      * group field with another ID, modifying the group data in place.
      *
      * @param {string} key name of group field to update
      * @param {Object} fullGroup actual group to modify
      * @param {string} IDToReplace id to replace
      * @param {string} replacementID replacement id
      *
    */
    static #groupReplaceHelper(key, fullGroup, IDToReplace, replacementID) {
        if (fullGroup.value[key]?.includes(IDToReplace)) {
            let updated = fullGroup.value[key].filter((x) => x != IDToReplace);
            updated.push(replacementID);
            fullGroup.value = {
                ...fullGroup.value,
                [key]: updated,
            };
        }
    }
    /**
   * Helper function that checks if the specified ID is in the specified
   * group field's list.
   *
   * @param {string} key name of group field to check
   * @param {Object} fullGroup actual group to check
   * @param {string} IDToCheck id to check for
   *
   * @private
   */
    static #groupContainsHelper(key, fullGroup, IDToCheck) {
        if (fullGroup.value[key]?.includes(IDToCheck)) {
            return true;
        }
        return false;
    }
    /**
     * Replaces specified ID with another ID in all fields of a group.
     *
     * @param {Object} group group to modify
     * @param {string} IDToReplace id to replace
     * @param {string} replacementID replacement id
     * @returns {Object} new group with all instances of IDToReplace replaced with
     *   replacementID
     *
     * @private
     */
    static groupReplace(group, IDToReplace, replacementID) {
        let updatedGroup = group;
        if (group.id === IDToReplace) {
            updatedGroup = {
                ...updatedGroup,
                id: replacementID,
            };
        }
        this.#groupReplaceHelper(PARENTS, updatedGroup, IDToReplace, replacementID);
        this.#groupReplaceHelper(CHILDREN, updatedGroup, IDToReplace, replacementID);
        return updatedGroup;
    }
    /**
     * Checks if specified ID is in any of a group's fields.
     *
     * @param {Object} group group to modify
     * @param {string} IDToCheck id to check for
     * @returns {boolean}
     *
     * @private
     */
    static groupContains(group, IDToCheck) {
        if (group.id === IDToCheck) {
            return true;
        }
        let bool = false;
        bool ||= this.#groupContainsHelper(PARENTS, group, IDToCheck);
        bool ||= this.#groupContainsHelper(CHILDREN, group, IDToCheck);
        return bool;
    }
    /**
     * Gets all groups on current device.
     *
     * @returns {Object[]}
     *
     * @private
     */
    // FIXME getMany should maybe use "id" as the first field instead of "key"
    // (so it can return groupObjType[]) unless the key really is the full LS key
    static getAllGroups() {
        return this.#storageWrapper.getMany(Groups.PREFIX);
    }
    /**
     * Recursively gets all children groups in the subtree with root groupID (result includes the root group).
     *
     * @param {string} groupID ID of group to get all subgroups of
     * @returns {Object[]}
     *
     * @private
     */
    static getAllSubgroups(groupIDs) {
        let groups = [];
        groupIDs.forEach((groupID) => {
            let group = this.#getGroup(groupID);
            if (group !== null) {
                groups.push({
                    id: groupID,
                    value: group,
                });
                if (group.children !== undefined) {
                    groups = groups.concat(this.getAllSubgroups(group.children));
                }
            }
        });
        return groups;
    }
    /**
     * Recursively gets all children groups in the subtree with root groupID (result includes the root group).
     *
     * @param {string} groupID ID of group to get all subgroups of
     * @returns {Object[]}
     *
     * @private
     */
    static getAllSubgroupNames(groupIDs) {
        let groups = [];
        groupIDs.forEach((groupID) => {
            let group = this.#getGroup(groupID);
            if (group !== null) {
                groups.push(group.id);
                if (group.children !== undefined) {
                    groups = groups.concat(this.getAllSubgroupNames(group.children));
                }
            }
        });
        return groups;
    }
    /**
     * Checks if a groupID is a member of a group.
     *
     * @param {string} toCheckGroupID ID of group to check for
     * @param {string[]} groupIDList list of group IDs to check all children of
     * @returns {boolean}
     *
     * @private
     */
    static isMember(toCheckGroupID, groupIDList) {
        return this.getAllSubgroupNames(groupIDList).includes(toCheckGroupID);
    }
}

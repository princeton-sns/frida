import { Groups } from "./groups";
import { LocalStorageWrapper } from "../db/localStorageWrapper.js";
export class Permissions {
    #linkedGroupId = "";
    static #storageWrapper = new LocalStorageWrapper();
    constructor(linkedGroup, storage) {
        this.#linkedGroupId = linkedGroup;
        // this.#storageWrapper = storage;
        //TODO: support not just admin, write, read privileges
        //can be developer defined 
    }
    static #getPermissions(objectKey) {
        return this.#storageWrapper.get(objectKey).perms;
    }
    static #setPermissions(objectKey, permissionField) {
        let object = this.#storageWrapper.get(objectKey);
        object.perms = permissionField;
        this.#storageWrapper.set(objectKey, object);
    }
    // TODO: combine setGroup functions into one
    // like setGroup(permField, groupId)
    /**
     * Append GroupId to readers in permissions
     * @param objectKey
     * @param groupId
     */
    static addReader(objectKey, groups) {
        let perms = this.#getPermissions(objectKey);
        let newPerms = {
            admin: perms.admin,
            write: perms.write,
            read: perms.read.concat(groups),
        };
        this.#setPermissions(objectKey, newPerms);
    }
    /**
     * Append GroupId to readers in permissions
     * @param objectKey
     * @param groupId
     */
    static addWriter(objectKey, groups) {
        let perms = this.#getPermissions(objectKey);
        let writers = [perms.write].concat(groups);
        let newWriteGroup = Groups.newGroup(undefined, false, writers);
        let newPerms = {
            admin: perms.admin,
            write: newWriteGroup,
            read: perms.read,
        };
        this.#setPermissions(objectKey, newPerms);
    }
    /**
     * Append GroupId to readers in permissions
     * @param objectKey
     * @param groupId
     */
    static addAdmin(objectKey, groups) {
        let perms = this.#getPermissions(objectKey);
        let admins = [perms.admin].concat(groups);
        let newAdminGroup = Groups.newGroup(undefined, false, admins);
        let newPerms = {
            admin: newAdminGroup,
            write: perms.write,
            read: perms.read,
        };
        this.#setPermissions(objectKey, newPerms);
    }
    /**
     *
     * @param objectKey
     * @param groupId
     */
    static removeReader(objectKey, groupId) {
        let perms = this.#getPermissions(objectKey);
        let newRead = [];
        for (let r in perms.read) {
            if (r != groupId) {
                newRead.push(r);
            }
        }
        let newPerms = {
            admin: perms.admin,
            write: perms.write,
            read: newRead,
        };
        this.#setPermissions(objectKey, newPerms);
    }
    /**
     * Remove GroupId to writers in permissions
     * @param objectKey
     * @param groupId
     *
     */
    static removeWriter(objectKey, groupId) {
        let perms = this.#getPermissions(objectKey);
        let newWriteGroup = Groups.removeFromGroup(perms.write, groupId);
        let newPerms = {
            admin: perms.admin,
            write: newWriteGroup,
            read: perms.read,
        };
        this.#setPermissions(objectKey, newPerms);
    }
    /**
     * Remove GroupId to readers in permissions
     * @param objectKey
     * @param groupId
     *
     * FIX: should this remove admin from group or
     * make new group without admin
     */
    static removeAdmin(objectKey, groupId) {
        let perms = this.#getPermissions(objectKey);
        let newAdminGroup = Groups.removeFromGroup(perms.admin, groupId);
        let newPerms = {
            admin: newAdminGroup,
            write: perms.write,
            read: perms.read,
        };
        this.#setPermissions(objectKey, newPerms);
    }
    static setPermissionField(objectKey, adminGroupId, writeGroupId, readGroupId) {
        let newPerms = {
            admin: adminGroupId,
            write: writeGroupId,
            read: readGroupId
        };
        this.#setPermissions(objectKey, newPerms);
    }
    static copyPermissions(toShareKey, toCopyKey) {
        let perms = this.#getPermissions(toCopyKey);
        this.#setPermissions(toShareKey, perms);
    }
    // TODO: make general(permType, deviceId)
    static hasReadPermissions(objectKey, deviceId) {
        let perms = this.#getPermissions(objectKey);
        if (Groups.isMember(deviceId, perms.read.concat(perms.write, perms.admin))) {
            return true;
        }
        return false;
    }
    static hasWritePermissions(objectKey, deviceId) {
        let perms = this.#getPermissions(objectKey);
        if (Groups.isMember(deviceId, [perms.write, perms.admin])) {
            return true;
        }
        return false;
    }
    static hasAdminPermissions(objectKey, deviceId) {
        let perms = this.#getPermissions(objectKey);
        if (Groups.isMember(deviceId, [perms.admin])) {
            return true;
        }
        return false;
    }
    /**
     * Unshares data item by creating new group that excludes groupID (commonly
     * a contact's name or any other subgroup). Propagates the new group info
     * to the new group members and deletes old group and data from groupID's
     * devices.
     *
     * @param {string} prefix data prefix
     * @param {string} id data id
     * @param {string} toUnshareGroupID id with which to unshare data
     *
     * @private
     */
    static unshareData(key, toUnshareGroupID) {
        if (Permissions.hasAdminPermissions(key, toUnshareGroupID)) {
            Permissions.removeAdmin(key, toUnshareGroupID);
        }
        if (Permissions.hasWritePermissions(key, toUnshareGroupID)) {
            Permissions.removeWriter(key, toUnshareGroupID);
        }
        if (Permissions.hasReadPermissions(key, toUnshareGroupID)) {
            Permissions.removeReader(key, toUnshareGroupID);
        }
    }
}

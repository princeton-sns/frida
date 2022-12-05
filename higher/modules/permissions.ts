import { Groups } from "./groups";
import { LocalStorageWrapper } from "../db/localStorageWrapper.js";

/**
 * EXPLAIN: has to be ONE GROUP per permission field
 *  or else you can have multiple writers that do not
 *  know about each other, etc... 
 *  or else have to introduce more logic here
 *  but readers don't necessarily have to know about
 *  all other readers
 *  */
export type permissionField = {
    admin: string
    write: string,
    read: string[],
}

export class Permissions {

    #linkedGroupId: string = "";
    static #storageWrapper = new LocalStorageWrapper();


    constructor(linkedGroup, storage) {
        this.#linkedGroupId = linkedGroup;
        // this.#storageWrapper = storage;

        //TODO: support not just admin, write, read privileges
        //can be developer defined 
    }

    static #getPermissions(objectKey): permissionField {
        return this.#storageWrapper.get(objectKey).perms;
    }

    static #setPermissions(objectKey, permissionField) {
        let object = this.#storageWrapper.get(objectKey);
        object.perms = permissionField;
        this.#storageWrapper.set(objectKey, object)
    }

    // TODO: combine setGroup functions into one
    // like setGroup(permField, groupId)

    /**
     * Append GroupId to readers in permissions
     * @param objectKey 
     * @param groupId 
     */

    static addReader(objectKey, groups: string[]) {
        let perms = this.#getPermissions(objectKey);

        let newPerms: permissionField = {
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

    static addWriter(objectKey, groups: string[]) {
        let perms = this.#getPermissions(objectKey);

        let writers = [perms.write].concat(groups)
        let newWriteGroup = Groups.newGroup(undefined, false, writers)
        let newPerms: permissionField = {
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

    static addAdmin(objectKey, groups: string[]) {
        let perms = this.#getPermissions(objectKey);

        let admins = [perms.admin].concat(groups)
        let newAdminGroup = Groups.newGroup(undefined, false, admins)
        let newPerms: permissionField = {
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
    static removeReader(objectKey: string, groupId: string) {
        let perms = this.#getPermissions(objectKey);
        let newRead: string[] = []

        for (let r in perms.read) {
            if (r != groupId) {
                newRead.push(r);
            }
        }

        let newPerms: permissionField = {
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
    static removeWriter(objectKey: string, groupId: string) {
        let perms = this.#getPermissions(objectKey);
        let newWriteGroup = Groups.removeFromGroup(perms.write, groupId)

        let newPerms: permissionField = {
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
    static removeAdmin(objectKey: string, groupId: string) {
        let perms = this.#getPermissions(objectKey);
        let newAdminGroup = Groups.removeFromGroup(perms.admin, groupId)

        let newPerms: permissionField = {
            admin: newAdminGroup,
            write: perms.write,
            read: perms.read,
        };

        this.#setPermissions(objectKey, newPerms);
    }

    static setPermissionField(objectKey, adminGroupId, writeGroupId, readGroupId) {

        let newPerms: permissionField = {
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

    static hasReadPermissions(objectKey, deviceId): boolean {
        let perms = this.#getPermissions(objectKey);
        if (Groups.isMember(deviceId, perms.read.concat(perms.write, perms.admin))) {
            return true
        }
        return false;
    }
    static hasWritePermissions(objectKey, deviceId): boolean {
        let perms = this.#getPermissions(objectKey);
        if (Groups.isMember(deviceId, [perms.write, perms.admin])) {
            return true
        }
        return false;
    }

    static hasAdminPermissions(objectKey, deviceId): boolean {
        let perms = this.#getPermissions(objectKey);
        if (Groups.isMember(deviceId, [perms.admin])) {
            return true
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
    static unshareData(key: string, toUnshareGroupID: string) {
        if (Permissions.hasAdminPermissions(key, toUnshareGroupID)) {
            Permissions.removeAdmin(key, toUnshareGroupID)
        }
        if (Permissions.hasWritePermissions(key, toUnshareGroupID)) {
            Permissions.removeWriter(key, toUnshareGroupID)
        }
        if (Permissions.hasReadPermissions(key, toUnshareGroupID)) {
            Permissions.removeReader(key, toUnshareGroupID)
        }
    }

}
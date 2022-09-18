/*
 ******
 * DB *
 ******
 */

export function set(key, value) {
  localStorage.setItem(
    key,
    toString(value)
  );
}

export function get(key) {
  return fromString(localStorage.getItem(key));
}

export function remove(key) {
  localStorage.removeItem(key);
}

export function clear() {
  localStorage.clear();
}

/*
 ***********
 * Helpers *
 ***********
 */

export function toString(obj) {
  return JSON.stringify(obj);
}

export function fromString(str) {
  return JSON.parse(str);
}

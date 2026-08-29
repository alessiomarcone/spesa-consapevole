export class ProfileStore {
  async read() {
    throw new Error("ProfileStore.read() is not implemented.");
  }

  async replace() {
    throw new Error("ProfileStore.replace() is not implemented.");
  }
}

export class InMemoryProfileStore extends ProfileStore {
  constructor(initialProfile = {}) {
    super();
    this.version = 1;
    this.profile = structuredClone(initialProfile);
  }

  async read() {
    return { version: this.version, profile: structuredClone(this.profile) };
  }

  async replace(expectedVersion, nextProfile) {
    if (expectedVersion !== this.version) {
      throw new Error(`Profile conflict: expected version ${expectedVersion}, current ${this.version}.`);
    }
    this.profile = structuredClone(nextProfile);
    this.version += 1;
    return this.read();
  }
}

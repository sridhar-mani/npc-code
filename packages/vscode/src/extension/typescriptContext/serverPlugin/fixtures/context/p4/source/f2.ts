import type { Both, Name, NameLength } from "./f1";

export class X implements Name, NameLength {
	name() {
		return "x";
	}
	length() {
		return "x".length;
	}
}

export class W implements Both {
	name() {
		return "w";
	}
	length() {
		return "w".length;
	}
}

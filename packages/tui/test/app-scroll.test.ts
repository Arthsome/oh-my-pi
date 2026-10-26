import { beforeAll, describe, expect, it } from "bun:test";
import { COMPOSER_DEFAULTS, Composer } from "@oh-my-pi/pi-tui/prompt/composer";
import { TranscriptContainer } from "@oh-my-pi/pi-tui/chrome/transcript-container";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import type { Component } from "@oh-my-pi/pi-tui";
import { VirtualTerminal } from "./virtual-terminal";

class Rows implements Component {
	constructor(private rows: readonly string[]) {}
	setRows(rows: readonly string[]): void {
		this.rows = rows;
	}
	render(): readonly string[] {
		return this.rows;
	}
}

describe("composer app-managed scroll", () => {
	beforeAll(() => {
		initTheme();
	});

	it("scrolls the live transcript while keeping the composer fixed", () => {
		const term = new VirtualTerminal(80, 16);
		const composer = new Composer({ terminal: term, preferences: { ...COMPOSER_DEFAULTS, quiet: true } });
		composer.start();
		try {
			const transcript = new TranscriptContainer();
			for (let index = 0; index < 30; index++) transcript.addChild(new Rows([`row-${index}`]));
			composer.setRuntimeChildren([transcript, composer.editor, new Rows(["FIXED"])]);
			const live = composer.renderFrame({ columns: 80, rows: 16 });
			expect(Bun.stripANSI(live.viewport.join("\n"))).toContain("row-29");
			expect(Bun.stripANSI(live.viewport.at(-1) ?? "")).toBe("FIXED");
			expect(composer.appScrollActive).toBe(false);

			expect(composer.scrollApp(-4)).toBe(true);
			const scrolled = composer.renderFrame({ columns: 80, rows: 16 });
			expect(composer.appScrollActive).toBe(true);
			expect(scrolled.history).toBeUndefined();
			const text = Bun.stripANSI(scrolled.viewport.join("\n"));
			expect(text).toContain("row-24");
			expect(text).not.toContain("row-29");
			expect(Bun.stripANSI(scrolled.viewport.at(-1) ?? "")).toBe("FIXED");

			expect(composer.scrollApp(-4)).toBe(true);
			const older = composer.renderFrame({ columns: 80, rows: 16 });
			expect(Bun.stripANSI(older.viewport.join("\n"))).toContain("row-20");
			expect(Bun.stripANSI(older.viewport.join("\n"))).not.toContain("row-26");
			expect(Bun.stripANSI(older.viewport.at(-1) ?? "")).toBe("FIXED");

			composer.endAppScroll();
			expect(composer.appScrollActive).toBe(false);
			const tail = composer.renderFrame({ columns: 80, rows: 16 });
			expect(Bun.stripANSI(tail.viewport.join("\n"))).toContain("row-29");
		} finally {
			composer.stop();
		}
	});

	it("opens a resumed transcript at its tail without native history", async () => {
		const term = new VirtualTerminal(80, 16);
		const composer = new Composer({ terminal: term, preferences: { ...COMPOSER_DEFAULTS, quiet: true } });
		composer.start();
		try {
			const transcript = new TranscriptContainer();
			for (let index = 0; index < 30; index++) transcript.addChild(new Rows([`row-${index}`]));
			composer.setRuntimeChildren([transcript, composer.editor, new Rows(["FIXED"])]);
			composer.startAppScrollAtTail();
			for (let attempt = 0; attempt < 4; attempt++) {
				const plan = composer.renderFrame({ columns: 80, rows: 16 });
				expect(plan.history).toBeUndefined();
			}
			await term.waitForRender(() => term.getViewport().join("\n").includes("row-29"));
			expect(term.getBufferPosition().baseY).toBe(0);
			expect(composer.appScrollActive).toBe(true);
			expect(Bun.stripANSI(term.getViewport().join("\n"))).toContain("row-29");

			expect(composer.scrollApp(-100)).toBe(true);
			const top = composer.renderFrame({ columns: 80, rows: 16 });
			expect(Bun.stripANSI(top.viewport.join("\n"))).toContain("row-0");
			expect(Bun.stripANSI(top.viewport.join("\n"))).not.toContain("row-29");

			composer.endAppScroll();
			const tail = composer.renderFrame({ columns: 80, rows: 16 });
			expect(tail.history).toBeUndefined();
			expect(Bun.stripANSI(tail.viewport.join("\n"))).toContain("row-29");
		} finally {
			composer.stop();
		}
	});

	it("leaves sticky startup mode when an explicit replay is requested", () => {
		const term = new VirtualTerminal(80, 16);
		const composer = new Composer({ terminal: term, preferences: { ...COMPOSER_DEFAULTS, quiet: true } });
		composer.start();
		try {
			const transcript = new TranscriptContainer();
			for (let index = 0; index < 30; index++) transcript.addChild(new Rows([`row-${index}`]));
			composer.setRuntimeChildren([transcript, composer.editor, new Rows(["FIXED"])]);
			composer.startAppScrollAtTail();
			composer.renderFrame({ columns: 80, rows: 16 });
			expect(composer.appScrollActive).toBe(true);

			composer.beginHistoryReplay();
			expect(composer.appScrollActive).toBe(false);
			const replay = composer.renderFrame({ columns: 80, rows: 16 });
			expect(replay.history?.kind).toBe("replay");
		} finally {
			composer.stop();
		}
	});

	it("enters app scroll from PageUp and returns at End", () => {
		const term = new VirtualTerminal(80, 16);
		const composer = new Composer({ terminal: term, preferences: { ...COMPOSER_DEFAULTS, quiet: true } });
		composer.start();
		try {
			const transcript = new TranscriptContainer();
			for (let index = 0; index < 30; index++) transcript.addChild(new Rows([`row-${index}`]));
			composer.setRuntimeChildren([transcript, composer.editor, new Rows(["FIXED"])]);
			composer.renderFrame({ columns: 80, rows: 16 });

			expect(composer.scrollAppKey("\x1b[5~")).toBe(true);
			expect(composer.appScrollActive).toBe(true);
			composer.renderFrame({ columns: 80, rows: 16 });
			expect(composer.scrollAppKey("\x1b[F")).toBe(true);
			expect(composer.appScrollActive).toBe(false);
		} finally {
			composer.stop();
		}
	});
	it("keeps acknowledged history available above the live tail", () => {
		const term = new VirtualTerminal(80, 16);
		const composer = new Composer({ terminal: term, preferences: { ...COMPOSER_DEFAULTS, quiet: true } });
		composer.start();
		try {
			const transcript = new TranscriptContainer();
			for (let index = 0; index < 30; index++) transcript.addChild(new Rows([`row-${index}`]));
			composer.setRuntimeChildren([transcript, composer.editor, new Rows(["FIXED"])]);
			for (let attempt = 0; attempt < 20; attempt++) {
				const plan = composer.renderFrame({ columns: 80, rows: 16 });
				if (plan.history === undefined) break;
				composer.acknowledgeHistory(plan.history.id);
			}

			expect(composer.scrollApp(-100)).toBe(true);
			const scrolled = composer.renderFrame({ columns: 80, rows: 16 });
			const text = Bun.stripANSI(scrolled.viewport.join("\n"));
			expect(text).toContain("row-0");
			expect(text).not.toContain("row-29");
			expect(Bun.stripANSI(scrolled.viewport.at(-1) ?? "")).toBe("FIXED");
		} finally {
			composer.stop();
		}
	});
	it("paints the scrolled viewport while the terminal stays at the bottom", async () => {
		const term = new VirtualTerminal(80, 16);
		const composer = new Composer({ terminal: term, preferences: { ...COMPOSER_DEFAULTS, quiet: true } });
		composer.start();
		try {
			const transcript = new TranscriptContainer();
			for (let index = 0; index < 30; index++) transcript.addChild(new Rows([`row-${index}`]));
			const progress = new Rows(["FIXED"]);
			composer.setRuntimeChildren([transcript, composer.editor, progress]);
			await term.waitForRender(() => term.getViewport().join("\n").includes("row-29"));

			composer.scrollApp(-4);
			await term.waitForRender(() => term.getViewport().join("\n").includes("row-24"));
			const viewport = Bun.stripANSI(term.getViewport().join("\n"));
			expect(viewport).toContain("row-24");
			expect(viewport).not.toContain("row-29");
			expect(viewport).toContain("FIXED");
			expect(term.isNativeViewportAtBottom()).toBe(true);

			progress.setRows(["WORKING 1"]);
			transcript.addChild(new Rows(["row-30"]));
			composer.ui.requestRender();
			await term.waitForRender(() => term.getViewport().join("\n").includes("WORKING 1"));
			const streaming = Bun.stripANSI(term.getViewport().join("\n"));
			expect(streaming).toContain("row-24");
			expect(streaming).not.toContain("row-30");
			expect(streaming).toContain("WORKING 1");
			expect(term.isNativeViewportAtBottom()).toBe(true);
		} finally {
			composer.stop();
		}
	});
});

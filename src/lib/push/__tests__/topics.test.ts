import { describe, expect, it } from "vitest";
import {
  BREAKING_TOPIC,
  categoryTargetForName,
  publisherNameForId,
  publisherTargetForSource,
  publisherTargetForUrl,
  topicForTarget,
} from "../topics";

/**
 * These names are a contract with the Flutter app's `push_segments.dart`:
 * the app subscribes `slnews_<follow id>` with `:` normalised to `_`. If a
 * future edit changes the format on either side, alerts stop arriving with no
 * error anywhere — hence the literal expectations below.
 */
describe("topicForTarget", () => {
  it("mirrors the app's topic names for every follow kind", () => {
    expect(topicForTarget("topic:politics")).toBe("slnews_topic_politics");
    expect(topicForTarget("team:lal")).toBe("slnews_team_lal");
    expect(topicForTarget("league:nba")).toBe("slnews_league_nba");
    expect(topicForTarget("publisher:awoko")).toBe("slnews_publisher_awoko");
    expect(topicForTarget("breaking")).toBe(BREAKING_TOPIC);
    expect(BREAKING_TOPIC).toBe("slnews_breaking");
  });

  it("replaces characters FCM does not allow", () => {
    expect(topicForTarget("topic:cars and vehicles")).toBe(
      "slnews_topic_cars_and_vehicles"
    );
    expect(topicForTarget("publisher:kallon's")).toBe("slnews_publisher_kallon_s");
    expect(topicForTarget("  team:lal  ")).toBe("slnews_team_lal");
  });
});

describe("categoryTargetForName", () => {
  it("uses the app's category id, not a slug of the display name", () => {
    expect(categoryTargetForName("Politics")).toBe("topic:politics");
    // The app's id for this category is `cars`; a plain slug would publish to
    // `topic:cars-and-vehicles`, which nobody subscribes to.
    expect(categoryTargetForName("Cars and Vehicles")).toBe("topic:cars");
    expect(categoryTargetForName("  cars  ")).toBe("topic:cars");
    expect(categoryTargetForName("World News")).toBe("topic:world");
  });

  it("never targets the home feed", () => {
    expect(categoryTargetForName("Top stories")).toBeNull();
    expect(categoryTargetForName("top")).toBeNull();
  });

  it("falls back to a slug for unknown single-word names", () => {
    expect(categoryTargetForName("Mining")).toBe("topic:mining");
    expect(categoryTargetForName("  ")).toBeNull();
  });
});

describe("publisherTargetForUrl", () => {
  it("maps a known outlet host to its publisher follow id", () => {
    expect(
      publisherTargetForUrl("https://www.thesierraleonetelegraph.com/story")
    ).toBe("publisher:sltelegraph");
    expect(publisherTargetForUrl("https://awoko.org/2026/01/budget")).toBe(
      "publisher:awoko"
    );
    expect(publisherTargetForUrl("https://politicosl.com/articles/1")).toBe(
      "publisher:politicosl"
    );
  });

  it("matches subdomains and the longest suffix", () => {
    expect(publisherTargetForUrl("https://sport.bbc.co.uk/football")).toBe(
      "publisher:bbcafrica"
    );
    expect(publisherTargetForUrl("https://news.awoko.org/story")).toBe(
      "publisher:awoko"
    );
  });

  it("returns null for unknown, missing or malformed URLs", () => {
    expect(publisherTargetForUrl("https://example.com/story")).toBeNull();
    expect(publisherTargetForUrl(null)).toBeNull();
    expect(publisherTargetForUrl("not a url")).toBeNull();
  });

  it("labels a publisher for the digest copy", () => {
    expect(publisherNameForId("awoko")).toBe("Awoko Newspaper");
    expect(publisherNameForId("nope")).toBeNull();
  });

  it("maps the scraper's outlet names to publisher ids", () => {
    expect(publisherTargetForSource("The Sierra Leone Telegraph")).toBe(
      "publisher:sltelegraph"
    );
    expect(publisherTargetForSource("Concord Times")).toBe(
      "publisher:concordtimes"
    );
    expect(publisherTargetForSource("politico sl")).toBe(
      "publisher:politicosl"
    );
    // Unknown outlets are skipped so a digest is never published to a topic
    // nobody could have subscribed to.
    expect(publisherTargetForSource("Some New Blog")).toBeNull();
    expect(publisherTargetForSource(null)).toBeNull();
  });
});

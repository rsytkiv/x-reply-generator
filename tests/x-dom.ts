// Builds HTML shaped like X's real tweet markup (checked against x.com in Oct 2026),
// without classes and styles. Only the structure the extractor relies on is kept.

export interface FakeTweet {
    id: string;
    handle: string;
    text?: string;
    /** Thread line coming from the post above. */
    connectedAbove?: boolean;
    /** The main post on a /status/ page. */
    focus?: boolean;
    ad?: boolean;
    showMore?: boolean;
    photos?: number;
    video?: boolean;
    card?: { domain: string; title: string };
    replyingTo?: string;
    quote?: { handle: string; text?: string; photo?: boolean };
}

const userName = (handle: string, statusId?: string) => `
    <div data-testid="User-Name">
        <a href="/${handle}"><span><span>${handle} Name</span></span></a>
        <a href="/${handle}" tabindex="-1"><span>@${handle}</span></a>
        <span>·</span>
        ${statusId ? `<a href="/${handle}/status/${statusId}"><time datetime="2026-10-15T10:00:00.000Z">2h</time></a>` : "<time>2h</time>"}
    </div>`;

const tweetText = (text: string) =>
    `<div data-testid="tweetText" lang="en"><span>${text.replace(/\n/g, "<br>")}</span></div>`;

export function tweet(t: FakeTweet): string {
    const quote = t.quote
        ? `<div role="link" tabindex="0">
               ${userName(t.quote.handle)}
               ${t.quote.text ? tweetText(t.quote.text) : ""}
               ${t.quote.photo ? '<div data-testid="tweetPhoto"><img alt="Image"></div>' : ""}
           </div>`
        : "";
    const media = [
        ...Array.from({ length: t.photos ?? 0 }, () => '<div data-testid="tweetPhoto"><img alt="Image"></div>'),
        t.video ? '<div data-testid="tweetPhoto"><div data-testid="videoPlayer"><video></video></div></div>' : "",
    ].join("");
    const card = t.card
        ? `<div data-testid="card.wrapper"><a href="https://t.co/abc">
               <div><span>From ${t.card.domain}</span></div><div><span>${t.card.title}</span></div>
           </a></div>`
        : "";
    const topStrip = t.connectedAbove ? "<div><div><div></div></div><div></div></div>" : "<div><div></div></div>";

    return `
    <div data-testid="cellInnerDiv">
      <article data-testid="tweet" tabindex="${t.focus ? "-1" : "0"}">
        <div>
          <div>${topStrip}</div>
          <div>
            <div><div data-testid="Tweet-User-Avatar"></div><div></div></div>
            <div>
              ${userName(t.handle, t.ad ? undefined : t.id)}
              ${t.ad ? "<span>Ad</span>" : ""}
              ${t.replyingTo ? `<div>Replying to <a href="/${t.replyingTo}">@${t.replyingTo}</a></div>` : ""}
              ${t.text ? tweetText(t.text) : ""}
              ${t.showMore ? '<button data-testid="tweet-text-show-more-link">Show more</button>' : ""}
              ${media}${card}${quote}
              <div role="group"><button data-testid="reply"></button></div>
            </div>
          </div>
        </div>
      </article>
    </div>`;
}

export function page(...tweets: FakeTweet[]): string {
    return tweets.map(tweet).join('<div data-testid="cellInnerDiv"><div></div></div>');
}

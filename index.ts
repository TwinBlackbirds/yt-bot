// This bot was inspired by a YouTube video I saw a couple months ago.
// It was titled something along the lines of 'How many videos does it take before YouTube will recommend an alt-right video?'
// I thought the experiment was poorly done and somewhat biased so I decided to create my own version.
// This webcrawler bot serves as that version.
// I will most likely make a video about this once the project is complete, reporting my findings.

/*
   I plan to use the following technologies:
   JavaScript
   Puppeteer
   Node.js
   R & R studio (for data analysis)
*/


import {Browser, ElementHandle, JSHandle, LaunchOptions, Page, TimeoutError, Viewport} from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import commandLineArgs from 'command-line-args';
import VideoDetails from "./Models/VideoDetails";
import CSVPayload from "./Models/CSVPayload";
import Groq from 'groq-sdk';
import {ChatCompletion} from "groq-sdk/resources/chat/completions";
import * as fs from "node:fs";

let SAVE_LOC: string = "";
get_save_loc().then((x) => {SAVE_LOC = x});

// stealth plugin
puppeteer.use(StealthPlugin())

// global groq client
const client = new Groq({
    // apiKey: process.env['GROQ_API_KEY'], // having issues with env var being recognized
});

// cli arg parsing (global)
let valid_args = [
    {name: 'help', alias: 'h', type: Boolean},
    {name: 'gui', alias: 'g', type: Boolean},
    {name: 'amount', alias: 'a', type: Number},
    {name: 'time', alias: 't', type: Number}
    // 'starter' - start at a certain video url (default: first video on homepage)
];
let opts = commandLineArgs(valid_args);

// help dialog
// DO NOT CALL AFTER INSTANTIATING BROWSER CONTEXT UNLESS YOU CLOSE IT MANUALLY
function print_help_and_exit(): void {
    console.log("----- twinblackbirds youtube bot manual ------");
    console.log("usage: node index.js [options]");
    console.log("options:");
    console.log("  -h, --help\t  print this help message");
    console.log("  -g, --gui\t  run in headful mode (graphical browser, default: false)");
    console.log("  -a, --amount\t  amount of videos to collect (default: unlimited)");
    console.log("  -t, --time\t  length of time to watch video in seconds (default: 180)");
    process.exit(0);
}

// example of using the groq api
async function ask_groq(message: string): Promise<ChatCompletion> {
    return client.chat.completions.create({
        messages: [{role: 'system', content: 'Respond only in one word.'}, { role: 'user', content: message }],
        model: 'llama3-8b-8192',
    });
    // .choices[0].message.content to access text content
}

async function get_save_loc(): Promise<string> {
    // get a unique path to save the csv to
    if (!fs.existsSync(`./csv`)) {
        fs.mkdirSync(`./csv`);
    }
    let date = Date.now().toString();
    let loc = `./csv/${date}.csv`
    while (fs.existsSync(`./csv/${date}.csv`)) {
        await sleep(1);
        date = Date.now().toString();
        loc = `./csv/${date}.csv`
    }
    console.log(`using csv path: '${loc}'`);
    return loc;
}

async function sleep(s: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, s * 1000));
}

async function skip_ad(tab: Page): Promise<void> {
    console.log("checking for ad...");
    let skip_ad: ElementHandle | null = null;
    try {
        skip_ad = await tab.waitForSelector("button[id*='skip-button']", {timeout: 5000});
    } catch {
        skip_ad = null;
    }
    while (skip_ad != null) {
        await sleep(5); // wait for button to be clickable
        console.log("skipping ad...");
        try {
            await skip_ad.click(); // attempt skip
            skip_ad = await tab.waitForSelector("button[id*='skip-button']", {timeout: 10000});
        } catch {
            console.log("ad skipped!");
            return; // button is not there if we fail to click it (or find it), therefore no ad
        }
    }
    console.log("no ad found!");
}

function ensure_ascii(str: string) {
    let regex = /[^ -~]+/m;
    let test = regex.test(str);
    if (test) {console.log("title was not entirely ascii, omitting invalid characters")}
    while (test) {
        test = regex.test(str);
        str = str.replace(regex, "");
    }
    return str;
}

function de_jshandle(handle: JSHandle): string {
    return handle.toString().replace("JSHandle:", "");
}

// pull the data from the page and create a VideoDetails class
async function gather_video_details(tab: Page): Promise<[VideoDetails, boolean]> {
    console.log("gathering video details...");

    let video_details = new VideoDetails();

    let title = await tab.waitForSelector("div[id='title'] yt-formatted-string[title]");
    let title_handle = await title.getProperty("textContent");
    let title_text = de_jshandle(title_handle);

    let meta_title = await tab.$("meta[name='title']");
    let meta_handle = await meta_title.getProperty("content");
    let meta_title_text = de_jshandle(meta_handle);

    let fails = 0;
    while (title_text.trim() != meta_title_text.trim()) {
        if (fails > 10) {
            console.log("could not get correct metadata after 10 attempts. leaving this video...")
            return [new VideoDetails(), false]
        }
        console.log("invalid metadata! attempting to reload the page...")

        try {
            title = await tab.waitForSelector("div[id='title'] yt-formatted-string[title]", {timeout: 5000});
            let tc = await title.getProperty("textContent");
            title_text = de_jshandle(tc);
        } catch {
            title_text = "No Title Element";
        }
        try {
            meta_title = await tab.waitForSelector("meta[name='title']", {timeout: 5000});
            let tc = await meta_title.getProperty("content");
            meta_title_text = de_jshandle(tc);
        } catch {
            meta_title_text = "No Meta Title Element";
        }
        try {
            await tab.reload({timeout: 15000});
        } catch {
            console.log("could not reload the tab for some reason. going back to homepage...")
            return [new VideoDetails(), false]
        }
        fails++;
    }

    title_text = ensure_ascii(title_text);

    let url = tab.url();

    // cant get the likes because of a youtube change
    let likes = "";

    let comments = await tab.$("ytd-comments-header-renderer yt-formatted-string > span");
    let comments_text = "";
    let comment_fails: number = 0;
    while (comments == null) {

        if (comment_fails % 3 == 0 && comment_fails != 0)
        {
            console.log(`still can't find the comment count, reloading the page... (${comment_fails}) ${tab.url()}`);
            try {
                await tab.reload({timeout: 15000});
            } catch {
                console.log("could not reload the tab for some reason. going back to homepage...")
                return [new VideoDetails(), false]
            }
        }

        if (comment_fails > 10)
        {
            console.log("could not find comments after 10 attempts. leaving this video...")
            return [new VideoDetails(), false]
        }

        for (let i = 0; i < comment_fails; i++)
        {
            await tab.evaluate(() => (this.window.scrollBy(0, 1080)))
            await sleep(3);
        }

        try
        {
            comments = await tab.waitForSelector(
                "ytd-comments-header-renderer yt-formatted-string > span",
                { timeout: 5000 });
            comments_text = de_jshandle(await comments.getProperty("textContent"));
        }
        catch
        {
            comments = null;

            // check if comments are turned off
            let disabled_comments = await tab.$("#message > span");
            if (disabled_comments != null)
            {
                let innerText = await disabled_comments.getProperty("innerText");
                let value = await innerText.jsonValue();
                if (value.toLowerCase().includes("turned off")) {
                    comments_text = "N/A (disabled)";
                    break;
                }
            }

            comment_fails++;
            console.log(`comment count not found, attempt to load it... (${comment_fails})`);
        }
    }
    console.log("comment count found!");

    let duration = await tab.$("span[class*='ytp-time-wrapper'] > .ytp-time-duration");
    let duration_handle = await duration.getProperty("textContent");
    let duration_text = de_jshandle(duration_handle)

    let thumbnail = await tab.$("link[rel='image_src']"); // get href
    let thumbnail_handle = await thumbnail.getProperty("href");
    let thumbnail_url = de_jshandle(thumbnail_handle);

    let channel_name = await tab.$("div[id='owner'] yt-formatted-string[title]");
    let channel_name_handle = await channel_name.getProperty("textContent");
    let channel_name_text = de_jshandle(channel_name_handle);

    let channel_sub_count = await tab.$("yt-formatted-string#owner-sub-count");
    let channel_sub_count_handle = await channel_sub_count.getProperty("textContent");
    let channel_sub_count_text = de_jshandle(channel_sub_count_handle);
    channel_sub_count_text = channel_sub_count_text.toLowerCase()
        .replaceAll(" subscribers", "")
        .toUpperCase();

    let channel_url = await tab.$("div[id='owner'] a[class*='yt-formatted-string']");
    let channel_url_handle = await channel_url.getProperty("href");
    let channel_url_text = de_jshandle(channel_url_handle);

    let date_and_views_info = await tab.waitForSelector("ytd-watch-info-text div#tooltip", {timeout: 5000});
    let date_and_views_info_handle = await date_and_views_info.getProperty("textContent");
    let date_and_views_text_arr = de_jshandle(date_and_views_info_handle).split("•");

    let views_text = date_and_views_text_arr[0].trim()
        .replaceAll(",", "")
        .replaceAll(" views", "");
    let date_uploaded_text = date_and_views_text_arr[1].trim();

    let date_gathered_text = Date.now().toString();

    let description_snippet = await tab.$("meta[name='description']");
    let description_snippet_handle = await description_snippet.getProperty("content");
    let description_text = de_jshandle(description_snippet_handle);

    let tags = await tab.$("meta[name='keywords']");
    let tags_handle = await tags.getProperty("content");
    let tags_text = de_jshandle(tags_handle);

    video_details.title = title_text;
    video_details.url = remove_timestamp(url);
    video_details.views = views_text;
    video_details.likes = likes; // having issues with this since it is a bunch of "scrolling number renderers"
    video_details.comments = comments_text;
    video_details.duration = duration_text;
    video_details.thumbnail = thumbnail_url;
    video_details.channel = channel_name_text;
    video_details.channel_sub_count = channel_sub_count_text;
    video_details.channel_url = channel_url_text;
    video_details.date_uploaded = date_uploaded_text;
    video_details.date_collected = date_gathered_text;
    video_details.description = description_text;
    video_details.tags = tags_text;

    if (opts.debug) {
        console.log(video_details);
    }
    return [video_details, true];
}

async function get_starting_video(tab: Page): Promise<string> {
    await tab.goto('https://www.youtube.com/');
    await tab.waitForSelector('div[id="content"');
    let fails = 1;
    let no_feed: ElementHandle | null = await tab.$("div[id='content'] > [contents-location='FEED_NUDGE_CONTENTS_LOCATION_UNKNOWN']");
    let _continue = (no_feed != null);
    _continue ? console.log(`attempting to get a recommended feed... (${fails})`) : console.log("feed found!");
    while (_continue) { // we do not have a feed ('search to get started' dialog)
        try {
            let shorts_button: ElementHandle = await tab.waitForSelector(
                    "ytd-guide-entry-renderer > a[id='endpoint'][title='Shorts']",
                    {timeout: 10000});
            await shorts_button.click();
            await tab.waitForSelector('video', {timeout: 10000});
            await sleep(3); // watch for 3 seconds
        } finally {
            await tab.goto('https://www.youtube.com/');
        }
        try {
            no_feed = await tab.waitForSelector(
                "div[id='content'] > [contents-location='FEED_NUDGE_CONTENTS_LOCATION_UNKNOWN']",
                {timeout: 5000});
        } catch (e) {
            if (e instanceof TimeoutError) {
                console.log("feed found! double checking...");
                try {
                    let check: ElementHandle = await tab.waitForSelector("a#video-title-link", {timeout: 5000});
                    if (check != null) {
                        break;
                    }
                } catch {
                    _continue = true;
                }
            }
            else throw e;
        }
        fails++;
        console.log(`attempting to get a recommended feed... (${fails})`);
        _continue = (no_feed != null);
    }
    console.log("getting starting url...");
    // depends on the run mode, but for now it will just be the first video in homepage
    let first_video: ElementHandle = await tab.waitForSelector("a#video-title-link", {timeout: 5000});
    let handle: JSHandle = await first_video.getProperty("href");
    let url = de_jshandle(handle);
    url = remove_timestamp(url);
    console.log(`starting url: '${url}'`);
    return url
}

async function get_next_url(tab: Page, seen_videos: string[]): Promise<string> {
    console.log("getting next url...");

    let all_vids: ElementHandle[] = [];
    try {
        await tab.waitForSelector("a.ytd-compact-video-renderer", {timeout: 15000});
    } finally {
        all_vids = await tab.$$("a.ytd-compact-video-renderer");
        if (all_vids.length == 0) {
            console.log("no sidebar videos found, restarting from homepage...");
            // noinspection ReturnInsideFinallyBlockJS
            return await get_starting_video(tab);
        }
    }

    let first_valid_video_idx = 0; // assume the first video is valid
    let prop: JSHandle = await all_vids[0].getProperty("href");
    let href = de_jshandle(prop);
    while (true) { // check validity
        if (
        href.indexOf('adservice') == -1 && // not an ad
        href.indexOf('watch?') > -1 &&  // is a video
        !seen_videos.includes(href)) { // hasn't been seen yet
            break;
        } // otherwise try next URL
        first_valid_video_idx++;

        // will give an out-of-bounds exception if we can't find a valid video (BAD STATE REGARDLESS!)
        try {
            let prop: JSHandle = await all_vids[first_valid_video_idx].getProperty("href");
            href = de_jshandle(prop);
        } catch {
            console.log("no sidebar videos found, restarting from homepage...");
            return await get_starting_video(tab);
        }
    }
    return remove_timestamp(href);
}

// sanitize input to prevent delimiter issues (`)
async function save_data_to_csv(payload: CSVPayload): Promise<void> {
    console.log("saving data to csv...");

    let csv_header: string = "";
    for (let key in payload) {
        csv_header += `${key}`;
        if (key !== Object.keys(payload)[Object.keys(payload).length - 1]) {
            csv_header += "`";
        }
    }
    csv_header += "\n";
    if (!fs.existsSync(SAVE_LOC)) {
        fs.writeFileSync(SAVE_LOC, csv_header);
    }
    let csv_string: string = "";
    for (let key in payload) {
        let value = payload[key];
        let sanitized_value: string = value.replaceAll("`", "'");
        csv_string += `${sanitized_value}`;
        if (key !== Object.keys(payload)[Object.keys(payload).length - 1]) {
            csv_string += "`"
        }
    }
    csv_string += "\n";
    fs.appendFileSync(SAVE_LOC, csv_string);
}

// using AI, summarize the video for categorization later
async function detect_video_topic(video_details: VideoDetails): Promise<CSVPayload> {
    console.log("detecting video topic...");
    let prompt = "Please determine a very general category for the following video: "
    for (let key in video_details) {
        prompt += `${key}: ${video_details[key]}\n`;
    }
    if (opts.debug) {
        console.log(prompt);
    }
    let ai_summary = await ask_groq(prompt);
    let message = ai_summary.choices[0].message.content;
    console.log(`got topic from ai: '${message}'`);
    return new CSVPayload(video_details, message);
}

async function watch_video(video_details: VideoDetails): Promise<void> {

    // parse video duration
    let dur_split = video_details.duration.split(":");
    let minutes = "0";
    if (dur_split.length > 3) { // if video is over a day
        minutes = dur_split[2];
    }
    else if (dur_split.length > 2) { // if video is over an hour
        minutes = dur_split[1];
    } else {
        minutes = dur_split[0];
    }
    let seconds = dur_split[dur_split.length - 1]; // get seconds (last)

    // get the amount of time we are supposed to watch if possible
    let time_to_watch_s = Math.floor(Math.random() * 180); // watch video for up to 3 minutes
    if (opts.time != null) { // cli argument override
        time_to_watch_s = parseInt(opts.time);
    }

    // make sure that we don't watch for too long
    let time_to_watch_actual = 0;
    if (parseInt(minutes) == 0 && time_to_watch_s > parseInt(seconds)) {
        time_to_watch_actual = parseInt(seconds);
    } else {
        time_to_watch_actual = time_to_watch_s;
    }
    console.log(`watching video "${video_details.title}" by '${video_details.channel}' (${video_details.channel_sub_count}) for ${time_to_watch_actual}s (video is ${video_details.duration} long)`);
    await sleep(time_to_watch_actual); // perform 'watching'
}

async function check_video_is_livestream(tab: Page): Promise<boolean> {
    console.log("checking if video is a livestream...");
    let video = null;
    while (video == null) {
        try {
            video = await tab.waitForSelector("video", {timeout: 10000});
        } catch {
            // a loading error must have occurred for this to happen
            console.log("video not found, reloading the page...");
            try {
                await tab.reload({timeout: 15000});
            } catch {
                console.log("failed to load the page. bypassing this video in an attempt to continue...")
                // something is seriously wrong with the state if this happens, so flag the url as bad
                return true;
            }
        }
    }
    let live_video = await tab.$(".ytp-clip-watch-full-video-button");
    let is_live = await live_video.getProperty("textContent");
    let jvalue = await is_live.jsonValue();
    if (!jvalue.includes("video")) {
        console.log("video is a livestream!");
        return true;
    }
    console.log("video is not a livestream!");
}

function remove_timestamp(orig_url: string) {
    let orig_url_split = orig_url.split("&");
    if (orig_url_split.length > 1) {
        console.log("removing timestamp from url...");
        return orig_url_split[0];
    }
    return orig_url;
}


async function run_bot(browser: Browser): Promise<boolean> {
    let tab = await browser.newPage();

    let cond = true;
    let amount = 0;
    if (opts.amount !== 'unlimited' && opts.amount != null) {
        amount = parseInt(opts.amount);
        cond = false;
    }
    let url = await get_starting_video(tab);

    // so we can skip duplicate videos
    let seen_videos: string[] = [];

    // watch video and nav endlessly (or if n is set, n times)
    while (cond || amount > 0) {
        console.log("navigating to video...")
        await tab.goto(url);

        let concurrent_livestreams = 0;

        let is_live = await check_video_is_livestream(tab);
        if (is_live) {
            if (concurrent_livestreams > 4) {
                console.log("stuck in livestream hell, going back to homepage");
                url = await get_starting_video(tab);
                continue;
            }
            console.log("video is live, skipping & blacklisting url...");
            seen_videos.push(remove_timestamp(tab.url()));

            await sleep(3);
            url = await get_next_url(tab, seen_videos);

            concurrent_livestreams++;
            continue;
        }
        concurrent_livestreams = 0;

        await skip_ad(tab);

        let [video_details, successful_extraction] = await gather_video_details(tab);

        // get video details
        if (!successful_extraction) {
            console.log("failed to gather video details, blacklisting url & restarting from homepage as a last resort...");
            seen_videos.push(remove_timestamp(tab.url()));
            await sleep(3);
            url = await get_starting_video(tab);
            continue;
        }

        seen_videos.push(video_details.url);

        let video_watching_promise =  watch_video(video_details);
        await sleep(1) // flush console output
        console.log("in the meantime:")

        // log the video details while watching
        let csv_payload = await detect_video_topic(video_details);
        await save_data_to_csv(csv_payload);
        url = await get_next_url(tab, seen_videos);

        console.log("finishing 'watching' the video now...")
        await Promise.resolve(video_watching_promise)

        // move on
        if (amount > 0) {amount--;}

    }
    return true;
    // TODO: statistic analysis, edge case error handling
    // TODO: VPN/proxy functionality
    // TODO: time taken to get video (this video - last video time) ? or the other way
}

// main
async function main() : Promise<void> {
    // cli args
    if (opts.help) { print_help_and_exit(); }
    console.log("configuring...");
    let headless: boolean  = (opts.gui == null ? true : opts.gui);

    // setup browser ctx
    let vp: Viewport = {width: 1920, height: 1080};
    let launch_options: LaunchOptions = {
        headless: headless,
        defaultViewport: vp,
        args: ['--mute-audio'],
        protocolTimeout: 120000
    }
    console.log("launching browser...");
    let browser: Browser = await puppeteer.launch(launch_options);

    // init main loop (run_bot)
    while (true) {
        try {
            let stop = await run_bot(browser);
            if (stop) {
                break;
            }
            console.log("error occurred with the browser, restarting...");
        } finally {
            // ensure browser ctx is not left hanging after our node.js program closes
            console.log("closing browser...");
            try {
                await browser.close();
                console.log("browser closed");
            } catch {
                console.log("browser already closed");
            }
        }
    }

}

main().then(() => console.log("commands executed"));

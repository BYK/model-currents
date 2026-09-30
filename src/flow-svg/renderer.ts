export interface FlowDatum {
    /** Time of the target observation, in milliseconds since the Unix epoch. */
    readonly time: number;
    /** Target category, such as a model, provider, or service. */
    readonly to: string;
    /** Optional source category for an observed transition. */
    readonly from?: string;
    /** Time of the source observation. Defaults to `time` when `from` is set. */
    readonly fromTime?: number;
    /** Non-negative quantity carried by the observation. Defaults to one. */
    readonly weight?: number;
}

export interface FlowNodeTitleContext {
    readonly key: string;
    readonly label: string;
    readonly time: number;
    readonly period: string;
    readonly value: number;
}

export interface FlowLinkTitleContext {
    readonly kind: 'entry' | 'transition' | 'intra-period';
    readonly from?: string;
    readonly to: string;
    readonly fromLabel?: string;
    readonly toLabel: string;
    readonly fromTime?: number;
    readonly time: number;
    readonly fromPeriod?: string;
    readonly toPeriod: string;
    readonly value: number;
}

export interface FlowContinuityTitleContext {
    readonly key: string;
    readonly label: string;
    readonly fromTime: number;
    readonly time: number;
    readonly fromPeriod: string;
    readonly toPeriod: string;
    readonly fromValue: number;
    readonly toValue: number;
    readonly movedEntryTitle?: string;
}

export interface FlowSvgOptions {
    readonly start: number;
    readonly end: number;
    readonly width: number;
    readonly height: number;
    /** Preferred left-to-right category order. Unlisted categories follow alphabetically. */
    readonly order?: readonly string[];
    /** Maps data values to display/grouping keys, for example a top-N "Other" bucket. */
    readonly displayKey?: (key: string) => string;
    readonly displayName?: (key: string) => string;
    readonly colorFor?: (key: string) => string;
    /** Colors a raw model stream without changing the color of its grouped node. */
    readonly streamColorFor?: (rawKey: string, displayKey: string) => string;
    readonly formatValue?: (value: number) => string;
    readonly formatPeriod?: (time: number, intervalDays: number) => string;
    readonly formatNodeTitle?: (context: FlowNodeTitleContext) => string;
    readonly formatLinkTitle?: (context: FlowLinkTitleContext) => string;
    readonly formatContinuityTitle?: (context: FlowContinuityTitleContext) => string;
    readonly axisCaption?: string;
    readonly ariaLabel?: string;
}

interface Period {
    readonly time: number;
    readonly label: string;
}

interface Node {
    readonly id: string;
    readonly key: string;
    readonly bucket: number;
    readonly rawKeys: Set<string>;
    readonly rawEventWeights: Map<string, number>;
    readonly rawOutgoingWeights: Map<string, number>;
    readonly continuityWeights: Map<string, number>;
    readonly continuityCenters: Map<string, number>;
    eventWeight: number;
    outgoingWeight: number;
    weight: number;
    y: number;
    height: number;
}

interface Link {
    readonly source: Node | null;
    readonly target: Node;
    weight: number;
    readonly kind: 'entry' | 'transition' | 'intra-period';
    readonly pairs: Map<string, readonly [string | null, string]>;
    sourceOffset: number;
    targetOffset: number;
}

export const FLOW_PALETTE = [
    '#ff7668',
    '#63c8bf',
    '#f2c45c',
    '#a7ce7e',
    '#c98bd8',
    '#74a6e8',
    '#a2adbb',
    '#d98858',
    '#c2cf69',
    '#df9ab7',
] as const;

const escapeSvg = (value: unknown): string =>
    String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

const defaultPeriodLabel = (time: number, intervalDays: number): string => {
    const date = new Date(time);
    return intervalDays === 30
        ? date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
        : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

const defaultValueLabel = (value: number): string => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);

const uniquePairKey = (pair: readonly [string | null, string]): string => JSON.stringify(pair);

const addPair = (pairs: Map<string, readonly [string | null, string]>, pair: readonly [string | null, string]): void => {
    pairs.set(uniquePairKey(pair), pair);
};

const addWeight = (weights: Map<string, number>, key: string, weight: number): number => {
    const total = (weights.get(key) ?? 0) + weight;
    if (!Number.isFinite(total)) throw new RangeError('Aggregated flow weights must remain finite.');
    weights.set(key, total);
    return total;
};

const makeNode = (id: string, key: string, bucket: number): Node => ({
    id,
    key,
    bucket,
    rawKeys: new Set(),
    rawEventWeights: new Map(),
    rawOutgoingWeights: new Map(),
    continuityWeights: new Map(),
    continuityCenters: new Map(),
    eventWeight: 0,
    outgoingWeight: 0,
    weight: 0,
    y: 0,
    height: 0,
});

/**
 * Render a time-bucketed, weighted flow diagram as a standalone SVG string.
 * The renderer has no DOM, framework, charting-library, or data-source dependency.
 */
export function renderFlowSvg(data: readonly FlowDatum[], options: FlowSvgOptions): string {
    const { start, end } = options;
    const width = Math.round(options.width);
    const height = Math.round(options.height);
    const maxDateTime = 8_640_000_000_000_000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || Math.abs(start) > maxDateTime || Math.abs(end) > maxDateTime) {
        throw new RangeError('Flow range must contain finite timestamps with end at or after start.');
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        throw new RangeError('Flow SVG dimensions must be positive finite numbers.');
    }

    const spanDays = Math.max(1, (end - start) / 86_400_000);
    if (!Number.isFinite(spanDays)) throw new RangeError('Flow range is too large to bucket safely.');
    const intervalDays = spanDays <= 35 ? 1 : spanDays <= 150 ? 7 : 30;
    const dayBucket = (time: number): number => Math.floor(time / 86_400_000) * 86_400_000;
    const periodFor = (time: number): number => {
        if (intervalDays === 30) {
            const date = new Date(time);
            return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
        }
        if (intervalDays === 7) {
            const day = Math.floor(time / 86_400_000);
            const mondayOffset = (new Date(day * 86_400_000).getUTCDay() + 6) % 7;
            return (day - mondayOffset) * 86_400_000;
        }
        return dayBucket(time);
    };
    const nextPeriod = (time: number): number => intervalDays === 30
        ? Date.UTC(new Date(time).getUTCFullYear(), new Date(time).getUTCMonth() + 1, 1)
        : time + intervalDays * 86_400_000;
    const firstBucket = periodFor(start);
    const lastBucket = periodFor(end);
    const periods: Period[] = [];
    for (let time = firstBucket; time <= lastBucket; time = nextPeriod(time)) {
        periods.push({ time, label: options.formatPeriod?.(time, intervalDays) ?? defaultPeriodLabel(time, intervalDays) });
    }
    if (periods.length === 0) periods.push({ time: firstBucket, label: options.formatPeriod?.(firstBucket, intervalDays) ?? defaultPeriodLabel(firstBucket, intervalDays) });

    const displayKey = options.displayKey ?? ((key: string) => key);
    const nodes = new Map<string, Node>();
    const categoryWeights = new Map<string, number>();
    const links: Link[] = [];
    const linkIndex = new Map<string, Link>();
    const periodIndexByTime = new Map(periods.map((period, index) => [period.time, index]));
    const previousPeriodByTime = new Map(periods.map((period, index) => [period.time, periods[index - 1]?.time]));
    const nodeFor = (key: string, bucket: number): Node => {
        const id = `${bucket}\u0000${key}`;
        let node = nodes.get(id);
        if (!node) {
            node = makeNode(id, key, bucket);
            nodes.set(id, node);
        }
        return node;
    };
    const linkFor = (source: Node | null, target: Node, kind: Link['kind'], pair: readonly [string | null, string], splitByRawPair: boolean): Link => {
        const rawIdentity = splitByRawPair ? uniquePairKey(pair) : '';
        const id = `${source?.id ?? 'entry'}\u0000${target.id}\u0000${kind}\u0000${rawIdentity}`;
        let link = linkIndex.get(id);
        if (!link) {
            link = { source, target, weight: 0, kind, pairs: new Map(), sourceOffset: 0, targetOffset: 0 };
            linkIndex.set(id, link);
            links.push(link);
        }
        return link;
    };

    for (const datum of data) {
        if (!Number.isFinite(datum.time) || Math.abs(datum.time) > maxDateTime || typeof datum.to !== 'string' || !datum.to.trim()) {
            throw new TypeError('Every flow datum needs a finite time and non-empty target key.');
        }
        const weight = datum.weight ?? 1;
        if (!Number.isFinite(weight) || weight < 0) {
            throw new RangeError('Flow weights must be finite, non-negative numbers.');
        }
        if (weight === 0 || datum.time < start || datum.time > end) continue;
        if (datum.from !== undefined && (typeof datum.from !== 'string' || !datum.from.trim())) {
            throw new TypeError('A provided flow source key must not be empty.');
        }
        const sourceTime = datum.fromTime ?? datum.time;
        if (!Number.isFinite(sourceTime) || Math.abs(sourceTime) > maxDateTime || sourceTime > datum.time) {
            throw new RangeError('A source timestamp must be finite and no later than its target timestamp.');
        }

        const targetKey = displayKey(datum.to);
        if (typeof targetKey !== 'string' || !targetKey.trim()) throw new TypeError('Displayed flow category keys must be non-empty strings.');
        const targetBucket = periodFor(datum.time);
        const target = nodeFor(targetKey, targetBucket);
        target.rawKeys.add(datum.to);
        target.eventWeight += weight;
        addWeight(target.rawEventWeights, datum.to, weight);
        const categoryWeight = (categoryWeights.get(targetKey) ?? 0) + weight;
        if (!Number.isFinite(target.eventWeight) || !Number.isFinite(categoryWeight)) throw new RangeError('Aggregated flow weights must remain finite.');
        categoryWeights.set(targetKey, categoryWeight);

        let source: Node | null = null;
        let sourceKey: string | null = null;
        let sourceBucket: number | null = null;
        if (datum.from !== undefined && sourceTime >= start) {
            sourceKey = displayKey(datum.from);
            if (typeof sourceKey !== 'string' || !sourceKey.trim()) throw new TypeError('Displayed flow category keys must be non-empty strings.');
            sourceBucket = periodFor(sourceTime);
            source = nodeFor(sourceKey, sourceBucket);
            source.rawKeys.add(datum.from);
            source.outgoingWeight += weight;
            addWeight(source.rawOutgoingWeights, datum.from, weight);
            categoryWeights.set(sourceKey, categoryWeights.get(sourceKey) ?? 0);
        }

        const kind: Link['kind'] = source === null ? 'entry' : sourceBucket === targetBucket ? 'intra-period' : 'transition';
        const pair: readonly [string | null, string] = [sourceKey, datum.to];
        if (source === null || source.key !== target.key) {
            const splitByRawPair = targetKey !== datum.to || (sourceKey !== null && sourceKey !== datum.from);
            const link = linkFor(source, target, kind, pair, splitByRawPair);
            link.weight += weight;
            addPair(link.pairs, pair);
        }
    }

    for (const node of nodes.values()) {
        node.weight = Math.max(node.eventWeight, node.outgoingWeight);
        const rawActivity = [...node.rawKeys].map((key) => [
            key,
            Math.max(node.rawEventWeights.get(key) ?? 0, node.rawOutgoingWeights.get(key) ?? 0),
        ] as const);
        const totalRawActivity = rawActivity.reduce((sum, [, weight]) => sum + weight, 0);
        if (!Number.isFinite(totalRawActivity)) throw new RangeError('Aggregated flow weights must remain finite.');
        if (totalRawActivity > 0) {
            for (const [key, weight] of rawActivity) {
                node.continuityWeights.set(key, (weight / totalRawActivity) * node.weight);
            }
        }
    }
    const nodeLists = new Map<number, Node[]>();
    for (const node of nodes.values()) {
        const list = nodeLists.get(node.bucket) ?? [];
        list.push(node);
        nodeLists.set(node.bucket, list);
    }
    const preferredOrder = new Map((options.order ?? []).map((key, index) => [key, index]));
    const compareNodes = (a: Node, b: Node): number =>
        (preferredOrder.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
            (preferredOrder.get(b.key) ?? Number.MAX_SAFE_INTEGER) ||
        a.key.localeCompare(b.key);
    for (const list of nodeLists.values()) list.sort(compareNodes);

    const columnWeights = [...nodeLists.values()].map((list) => list.reduce((sum, node) => sum + node.weight, 0));
    if (columnWeights.some((weight) => !Number.isFinite(weight))) throw new RangeError('Aggregated flow column weights must remain finite.');
    const maxColumnWeight = Math.max(1, ...columnWeights);
    const maxNodeCount = Math.max(1, ...[...nodeLists.values()].map((list) => list.length));
    const plotTop = 38;
    const plotBottom = height - 58;
    const plotHeight = Math.max(1, plotBottom - plotTop);
    const gap = Math.min(maxNodeCount > 30 ? 5 : 15, plotHeight / (maxNodeCount + 1));
    const valueScale = Math.max(0, (plotHeight - gap * (maxNodeCount - 1)) / maxColumnWeight);
    for (const list of nodeLists.values()) {
        const contentHeight = list.reduce((sum, node) => sum + node.weight * valueScale, 0) + gap * Math.max(0, list.length - 1);
        let y = plotTop + Math.max(0, (plotHeight - contentHeight) / 2);
        for (const node of list) {
            node.y = y;
            node.height = node.weight * valueScale;
            node.continuityCenters.clear();
            let continuityY = node.y;
            for (const [key, weight] of [...node.continuityWeights].sort(([a], [b]) => a.localeCompare(b))) {
                node.continuityCenters.set(key, continuityY + weight * valueScale / 2);
                continuityY += weight * valueScale;
            }
            y += node.height + gap;
        }
    }

    const incomingByNode = new Map<Node, Link[]>();
    const outgoingByNode = new Map<Node, Link[]>();
    for (const link of links) {
        const incoming = incomingByNode.get(link.target) ?? [];
        incoming.push(link);
        incomingByNode.set(link.target, incoming);
        if (link.source) {
            const outgoing = outgoingByNode.get(link.source) ?? [];
            outgoing.push(link);
            outgoingByNode.set(link.source, outgoing);
        }
    }
    const pairForLink = (link: Link): readonly [string | null, string] => link.pairs.values().next().value!;
    for (const node of nodes.values()) {
        const incomingByRawKey = new Map<string, Link[]>();
        for (const link of incomingByNode.get(node) ?? []) {
            const rawKey = pairForLink(link)[1];
            const incoming = incomingByRawKey.get(rawKey) ?? [];
            incoming.push(link);
            incomingByRawKey.set(rawKey, incoming);
        }
        let incomingOffset = node.y + Math.max(0, (node.height - node.eventWeight * valueScale) / 2);
        for (const [rawKey, rawWeight] of [...node.rawEventWeights].sort(([a], [b]) => a.localeCompare(b))) {
            const incoming = incomingByRawKey.get(rawKey) ?? [];
            if (incoming.length > 0) {
                incoming.sort((a, b) =>
                    (a.source?.bucket ?? Number.MIN_SAFE_INTEGER) - (b.source?.bucket ?? Number.MIN_SAFE_INTEGER) ||
                    (a.source?.y ?? a.target.y) - (b.source?.y ?? b.target.y) ||
                    (pairForLink(a)[0] ?? '').localeCompare(pairForLink(b)[0] ?? ''),
                );
                let rawOffset = incomingOffset;
                for (const link of incoming) {
                    link.targetOffset = rawOffset;
                    rawOffset += link.weight * valueScale;
                }
            }
            incomingOffset += rawWeight * valueScale;
        }

        const outgoingByRawKey = new Map<string, Link[]>();
        for (const link of outgoingByNode.get(node) ?? []) {
            const rawKey = pairForLink(link)[0];
            if (rawKey === null) continue;
            const outgoing = outgoingByRawKey.get(rawKey) ?? [];
            outgoing.push(link);
            outgoingByRawKey.set(rawKey, outgoing);
        }
        let outgoingOffset = node.y + Math.max(0, (node.height - node.outgoingWeight * valueScale) / 2);
        for (const [rawKey, rawWeight] of [...node.rawOutgoingWeights].sort(([a], [b]) => a.localeCompare(b))) {
            const outgoing = outgoingByRawKey.get(rawKey) ?? [];
            if (outgoing.length > 0) {
                outgoing.sort((a, b) =>
                    a.target.bucket - b.target.bucket || a.target.y - b.target.y || a.target.key.localeCompare(b.target.key) ||
                    pairForLink(a)[1].localeCompare(pairForLink(b)[1]),
                );
                let rawOffset = outgoingOffset;
                for (const link of outgoing) {
                    link.sourceOffset = rawOffset;
                    rawOffset += link.weight * valueScale;
                }
            }
            outgoingOffset += rawWeight * valueScale;
        }
    }

    const left = Math.min(width * 0.24, Math.max(38, width * 0.065));
    const right = Math.min(width * 0.16, Math.max(20, width * 0.035));
    const firstX = periods.length > 1 ? left + Math.min(45, width * 0.025) : width / 2;
    const lastX = periods.length > 1 ? Math.max(firstX, width - right) : firstX;
    const columnStep = periods.length > 1 ? (lastX - firstX) / (periods.length - 1) : 0;
    const xFor = (bucket: number): number => {
        const index = Math.max(0, Math.min(periods.length - 1, periodIndexByTime.get(bucket) ?? 0));
        return periods.length > 1 ? firstX + index * columnStep : firstX;
    };
    const nodeWidth = Math.min(12, Math.max(4, periods.length > 1 ? columnStep * 0.35 : width / 100));
    const getColor = options.colorFor ?? ((key: string) => {
        const keys = [...categoryWeights.keys()].sort(compareCategoryByOrder(preferredOrder));
        const index = Math.max(0, keys.indexOf(key));
        return FLOW_PALETTE[index % FLOW_PALETTE.length];
    });
    const getStreamColor = (rawKey: string, displayKey: string): string => options.streamColorFor?.(rawKey, displayKey) ?? getColor(displayKey);
    const getName = options.displayName ?? ((key: string) => key);
    const formatValue = options.formatValue ?? defaultValueLabel;
    const nameFor = (key: string): string => getName(key);
    const formatNodeTitle = (context: FlowNodeTitleContext): string =>
        options.formatNodeTitle?.(context) ?? `${context.period} · ${context.label} · ${formatValue(context.value)}`;
    const formatLinkTitle = (context: FlowLinkTitleContext): string => {
        if (options.formatLinkTitle) return options.formatLinkTitle(context);
        if (context.kind === 'entry') return `${formatValue(context.value)} into ${context.toLabel} (${context.toPeriod})`;
        if (context.kind === 'intra-period') {
            return `${formatValue(context.value)} ${context.fromLabel} → ${context.toLabel} within ${context.toPeriod}`;
        }
        return `${formatValue(context.value)} ${context.fromLabel} (${context.fromPeriod}) → ${context.toLabel} (${context.toPeriod})`;
    };

    const periodLabels = new Map(periods.map((period) => [period.time, period.label]));
    const tickSpacing = Math.max(44, Math.min(82, intervalDays === 30 ? 70 : intervalDays === 7 ? 60 : 54));
    const tickStride = Math.max(1, Math.ceil(tickSpacing / Math.max(1, columnStep)));
    const parts: string[] = [];
    parts.push(
        `<svg class="usage-chart flow-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" data-flow-plot-start-x="${firstX}" data-flow-plot-end-x="${lastX}" data-flow-plot-start-time="${firstBucket}" data-flow-plot-end-time="${lastBucket}" role="img" aria-label="${escapeSvg(options.ariaLabel ?? 'Chronological weighted flows between categories')}">`
    );

    for (const [index, period] of periods.entries()) {
        const x = xFor(period.time);
        parts.push(`<line class="chart-gridline" x1="${x}" y1="24" x2="${x}" y2="${plotBottom}" />`);
        if (index % tickStride === 0 || index === periods.length - 1) {
            parts.push(`<line class="date-tick" x1="${x}" y1="${plotBottom}" x2="${x}" y2="${plotBottom + 5}" />`);
            parts.push(`<text class="date-label" x="${x}" y="${plotBottom + 24}" text-anchor="middle">${escapeSvg(period.label)}</text>`);
        }
    }

    type EntryDetails = { titles: string[]; pairs: Map<string, readonly [string | null, string]> };
    const continuityEntries = new Map<string, EntryDetails>();
    const linkedEntries = new Map<Link, EntryDetails>();
    const absorbedEntryLinks = new Set<Link>();
    const addEntryDetails = <Key extends string | Link>(detailsByTarget: Map<Key, EntryDetails>, key: Key, link: Link, title: string): void => {
        const details: EntryDetails = detailsByTarget.get(key) ?? { titles: [], pairs: new Map<string, readonly [string | null, string]>() };
        details.titles.push(title);
        for (const [key, pair] of link.pairs) details.pairs.set(key, pair);
        detailsByTarget.set(key, details);
    };
    for (const link of links) {
        if (link.kind !== 'entry') continue;
        const [, entryTarget] = pairForLink(link);
        const context: FlowLinkTitleContext = {
            kind: link.kind,
            to: entryTarget,
            toLabel: nameFor(entryTarget),
            time: link.target.bucket,
            toPeriod: periodLabels.get(link.target.bucket) ?? '',
            value: link.weight,
        };
        const title = formatLinkTitle(context);
        const previousBucket = previousPeriodByTime.get(link.target.bucket);
        const previousNodes = previousBucket === undefined ? [] : nodeLists.get(previousBucket) ?? [];
        const continuousPredecessor = previousNodes.find((node) =>
            node.key === link.target.key && node.rawKeys.has(entryTarget),
        );
        if (continuousPredecessor) {
            addEntryDetails(continuityEntries, `${link.target.id}\u0000${entryTarget}`, link, title);
            absorbedEntryLinks.add(link);
            continue;
        }

        const observedPredecessor = links
            .filter((candidate) => candidate !== link && candidate.target === link.target && candidate.source !== null)
            .sort((a, b) => b.weight - a.weight)
            .find((candidate) => [...candidate.pairs.values()].some(([, target]) => target === entryTarget));
        if (observedPredecessor) {
            addEntryDetails(linkedEntries, observedPredecessor, link, title);
            absorbedEntryLinks.add(link);
        }
    }

    const formatContinuityTitle = options.formatContinuityTitle ?? ((context: FlowContinuityTitleContext) => {
        const carried = context.movedEntryTitle ? ` ${context.movedEntryTitle}` : '';
        return `Visual continuity: ${context.label} appears in ${context.fromPeriod} and ${context.toPeriod}; this does not track individual sessions.${carried}`;
    });
    for (let index = 0; index < periods.length - 1; index += 1) {
        const current = nodeLists.get(periods[index].time) ?? [];
        const next = nodeLists.get(periods[index + 1].time) ?? [];
        const nextByKey = new Map(next.map((node) => [node.key, node]));
        for (const node of current) {
            const following = nextByKey.get(node.key);
            if (!following) continue;
            const continuingKeys = [...node.rawKeys].filter((key) => following.rawKeys.has(key)).sort();
            for (const key of continuingKeys) {
                const fromWeight = node.continuityWeights.get(key) ?? 0;
                const toWeight = following.continuityWeights.get(key) ?? 0;
                if (fromWeight <= 0 || toWeight <= 0) continue;
                const x1 = xFor(node.bucket) + nodeWidth / 2;
                const x2 = xFor(following.bucket) - nodeWidth / 2;
                const startY = node.continuityCenters.get(key) ?? node.y + node.height / 2;
                const endY = following.continuityCenters.get(key) ?? following.y + following.height / 2;
                const control = Math.max(0, (x2 - x1) * 0.45);
                const fromBand = Math.min(node.height, Math.max(1, fromWeight * valueScale));
                const toBand = Math.min(following.height, Math.max(1, toWeight * valueScale));
                const path = `M ${x1} ${startY - fromBand / 2} C ${x1 + control} ${startY - fromBand / 2}, ${x2 - control} ${endY - toBand / 2}, ${x2} ${endY - toBand / 2} L ${x2} ${endY + toBand / 2} C ${x2 - control} ${endY + toBand / 2}, ${x1 + control} ${startY + fromBand / 2}, ${x1} ${startY + fromBand / 2} Z`;
                const attachedEntries = continuityEntries.get(`${following.id}\u0000${key}`);
                const title = formatContinuityTitle({
                    key,
                    label: nameFor(key),
                    fromTime: node.bucket,
                    time: following.bucket,
                    fromPeriod: periods[index].label,
                    toPeriod: periods[index + 1].label,
                    fromValue: node.rawEventWeights.get(key) ?? 0,
                    toValue: following.rawEventWeights.get(key) ?? 0,
                    movedEntryTitle: attachedEntries?.titles.join('. '),
                });
                const continuityPairMap = new Map<string, readonly [string | null, string]>();
                const pair = [null, key] as const;
                continuityPairMap.set(uniquePairKey(pair), pair);
                for (const [pairKey, attachedPair] of attachedEntries?.pairs ?? []) continuityPairMap.set(pairKey, attachedPair);
                const continuityPairs = escapeSvg(JSON.stringify([...continuityPairMap.values()]));
                parts.push(
                    `<path class="continuity-ribbon" d="${path}" fill="${escapeSvg(getStreamColor(key, node.key))}" opacity=".12" data-flow-action="link" data-flow-pairs="${continuityPairs}"><title>${escapeSvg(title)}</title></path>`
                );
            }
        }
    }

    const orderedLinks = [...links].sort((a, b) => {
        if (a.kind === 'entry' && b.kind !== 'entry') return -1;
        if (a.kind !== 'entry' && b.kind === 'entry') return 1;
        return (a.source?.y ?? a.target.y) - (b.source?.y ?? b.target.y);
    });
    for (const link of orderedLinks) {
        const targetX = xFor(link.target.bucket);
        const [sourceRawKey, targetRawKey] = pairForLink(link);
        const color = escapeSvg(getStreamColor(targetRawKey, link.target.key));
        const titleContext: FlowLinkTitleContext = {
            kind: link.kind,
            from: sourceRawKey ?? undefined,
            to: targetRawKey,
            fromLabel: sourceRawKey ? nameFor(sourceRawKey) : undefined,
            toLabel: nameFor(targetRawKey),
            fromTime: link.source?.bucket,
            time: link.target.bucket,
            fromPeriod: link.source ? periodLabels.get(link.source.bucket) : undefined,
            toPeriod: periodLabels.get(link.target.bucket) ?? '',
            value: link.weight,
        };
        const title = formatLinkTitle(titleContext);
        if (link.kind === 'entry') {
            if (absorbedEntryLinks.has(link)) continue;
            const backtailX = targetX - 38;
            const centerY = link.targetOffset + link.weight * valueScale / 2;
            const streamHeight = link.weight * valueScale;
            const clickPairs = escapeSvg(JSON.stringify([...link.pairs.values()]));
            const blockTop = centerY - Math.max(3, streamHeight) / 2;
            parts.push(
                `<rect class="flow-entry-block" x="${backtailX - 7}" y="${blockTop}" width="12" height="${Math.max(6, streamHeight)}" rx="3" fill="${color}" opacity=".62" data-flow-action="link" data-flow-pairs="${clickPairs}"><title>${escapeSvg(title)}</title></rect>`
            );
            const path = `M ${backtailX} ${centerY - streamHeight / 2} C ${backtailX + 18} ${centerY - streamHeight / 2}, ${targetX - 22} ${centerY - streamHeight / 2}, ${targetX - nodeWidth / 2} ${centerY - streamHeight / 2} L ${targetX - nodeWidth / 2} ${centerY + streamHeight / 2} C ${targetX - 22} ${centerY + streamHeight / 2}, ${backtailX + 18} ${centerY + streamHeight / 2}, ${backtailX} ${centerY + streamHeight / 2} Z`;
            parts.push(
                `<path class="flow-ribbon flow-entry" d="${path}" fill="${color}" opacity=".48" data-flow-action="link" data-flow-pairs="${clickPairs}"><title>${escapeSvg(title)}</title></path>`
            );
            continue;
        }

        const source = link.source;
        if (!source) continue;
        const sourceX = xFor(source.bucket);
        const sourceY = link.sourceOffset + link.weight * valueScale / 2;
        const targetY = link.targetOffset + link.weight * valueScale / 2;
        const streamHeight = Math.max(0.7, link.weight * valueScale);
        const leftEdge = sourceX + nodeWidth / 2;
        const rightEdge = targetX - nodeWidth / 2;
        const attachedEntries = linkedEntries.get(link);
        const clickPairMap = new Map(link.pairs);
        for (const [key, pair] of attachedEntries?.pairs ?? []) clickPairMap.set(key, pair);
        const clickPairs = escapeSvg(JSON.stringify([...clickPairMap.values()]));
        const linkedTitle = attachedEntries ? `${title}. ${attachedEntries.titles.join('. ')}` : title;
        const path = link.kind === 'intra-period'
            ? (() => {
                const edgeX = sourceX + nodeWidth / 2;
                const laneX = edgeX + Math.min(42, Math.max(24, width * 0.018));
                return `M ${edgeX} ${sourceY - streamHeight / 2} C ${laneX} ${sourceY - streamHeight / 2}, ${laneX} ${targetY - streamHeight / 2}, ${edgeX} ${targetY - streamHeight / 2} L ${edgeX} ${targetY + streamHeight / 2} C ${laneX} ${targetY + streamHeight / 2}, ${laneX} ${sourceY + streamHeight / 2}, ${edgeX} ${sourceY + streamHeight / 2} Z`;
            })()
            : (() => {
                const bend = Math.max(4, (rightEdge - leftEdge) * 0.46);
                return `M ${leftEdge} ${sourceY - streamHeight / 2} C ${leftEdge + bend} ${sourceY - streamHeight / 2}, ${rightEdge - bend} ${targetY - streamHeight / 2}, ${rightEdge} ${targetY - streamHeight / 2} L ${rightEdge} ${targetY + streamHeight / 2} C ${rightEdge - bend} ${targetY + streamHeight / 2}, ${leftEdge + bend} ${sourceY + streamHeight / 2}, ${leftEdge} ${sourceY + streamHeight / 2} Z`;
            })();
        parts.push(
            `<path class="flow-ribbon ${link.kind === 'intra-period' ? 'flow-intra' : 'flow-transition'}" d="${path}" fill="${color}" opacity="${link.kind === 'intra-period' ? '.58' : '.30'}" data-flow-action="link" data-flow-pairs="${clickPairs}"><title>${escapeSvg(linkedTitle)}</title></path>`
        );
    }

    for (const [index, period] of periods.entries()) {
        const list = nodeLists.get(period.time) ?? [];
        for (const node of list) {
            const x = xFor(period.time);
            const color = escapeSvg(getColor(node.key));
            const label = nameFor(node.key);
            const context: FlowNodeTitleContext = {
                key: node.key,
                label,
                time: period.time,
                period: period.label,
                value: node.eventWeight,
            };
            const title = formatNodeTitle(context);
            const rawValues = escapeSvg(JSON.stringify([...node.rawKeys]));
            parts.push(
                `<rect class="usage-node" x="${x - nodeWidth / 2}" y="${node.y}" width="${nodeWidth}" height="${Math.max(4, node.height)}" rx="3" fill="${color}" data-flow-action="node" data-flow-values="${rawValues}"><title>${escapeSvg(title)}</title></rect>`
            );
        }
        if (index === periods.length - 1) break;
    }

    const axisY = plotBottom + 1;
    parts.push(`<line class="date-axis" x1="${firstX}" y1="${axisY}" x2="${lastX}" y2="${axisY}" />`);
    parts.push(`<text class="axis-caption" x="${(firstX + lastX) / 2}" y="${height - 2}" text-anchor="middle">${escapeSvg(options.axisCaption ?? 'EARLIER ← TIME → LATER')}</text>`);
    parts.push('</svg>');
    return parts.join('');
}

const compareCategoryByOrder = (order: ReadonlyMap<string, number>) => (a: string, b: string): number =>
    (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b);

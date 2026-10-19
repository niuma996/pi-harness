/**
 * Vendored copy of chord's `defineService` descriptor constructor.
 *
 * `chord@1.x` dropped the whole facet/service subsystem that `chord@0.99.2` had:
 * `defineService`, `defineFacet`, `createFacetHost`, `createRemoteServiceBinding`
 * and the `RemoteService*` types are all gone, and the replacement `Service` in
 * `chord/object` is a different concept (a typebox contract plus a factory and a
 * facet name). There is no drop-in replacement, and porting the pico3 bridge to
 * the new model would mean rewriting it — which is out of scope for a package that
 * exists to freeze the 0.99.2 harness surface.
 *
 * `defineService` itself was never more than a frozen identity descriptor:
 *
 * ```ts
 * export function defineService(id, options) {
 *   if (id.length === 0) throw new TypeError("Service ID must not be empty");
 *   if (id.startsWith("$chord.")) throw new TypeError("Service IDs beginning with $chord. are reserved");
 *   return Object.freeze({ id, local: options?.local ?? false });
 * }
 * ```
 *
 * Nothing in this package hands a descriptor to a chord host, so vendoring it is
 * behaviour-preserving: the pico3 bridge tests exercise the descriptor only as a
 * type carrier. What is genuinely lost with chord 1.x is the ability to *publish*
 * these descriptors to a chord facet host — an API that no longer exists upstream
 * either way.
 *
 * Extracted verbatim from `earendil-works/pi@0.99.2` `packages/chord/src/api.ts`.
 */

const SERVICE_TYPE: unique symbol = Symbol.for("chord.service.type");

/** Stable identity for one shared TypeScript service contract. Mirrors chord@0.99.2. */
export interface Service<T> {
	readonly id: string;
	/** Process-local services accept unrestricted object contracts and are never published remotely. */
	readonly local: boolean;
	readonly [SERVICE_TYPE]?: (value: T) => T;
}

/** Chord service descriptor. `local: true` marks a process-local service. */
export function defineService<T>(id: string, options: { readonly local: true }): Service<T>;
export function defineService<T>(id: string, options?: { readonly local?: false }): Service<T>;
export function defineService(id: string, options?: { readonly local?: boolean }): Service<unknown> {
	if (id.length === 0) throw new TypeError("Service ID must not be empty");
	// TODO: check if the reserved namespace should be part of Chord.
	if (id.startsWith("$chord.")) throw new TypeError("Service IDs beginning with $chord. are reserved");
	return Object.freeze({ id, local: options?.local ?? false });
}

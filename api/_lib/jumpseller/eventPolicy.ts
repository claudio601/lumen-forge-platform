// api/_lib/jumpseller/eventPolicy.ts
// Canonical policy for how each Jumpseller webhook event should be handled.
// Single source of truth for event routing decisions across the system.

/**
 * Describes what a Jumpseller event is allowed to do in the CRM pipeline.
  */
  export interface JumpsellerEventPolicy {
    /** Whether this event is allowed to trigger deal creation. */
      canCreate: boolean;
        /** Whether this event is allowed to update an existing deal. */
          canUpdate: boolean;
            /** Whether this event should be ignored entirely (not even logged as action). */
              ignore: boolean;
              }

              // eLIGHTS Jumpseller is a quote-request flow, not a payment flow.
              // `order_updated` is the operational "new lead" event — it fires when a
              // customer submits the order for quotation. `order_paid` is also create-
              // capable defensively (in case payment is enabled later). Redis idempotency
              // (SET NX PX 30s + 30d mapping) absorbs duplicate events per order.
              const POLICIES: Record<string, JumpsellerEventPolicy> = {
                order_created: { canCreate: true,  canUpdate: true,  ignore: false },
                  order_paid:    { canCreate: true,  canUpdate: true,  ignore: false },
                    order_updated: { canCreate: true,  canUpdate: true,  ignore: false },
                    };

                    /** Default policy for unknown or unregistered events: do nothing. */
                    const IGNORE_POLICY: JumpsellerEventPolicy = { canCreate: false, canUpdate: false, ignore: true };

                    /**
                     * Returns the event policy for the given Jumpseller event type.
                      * Unknown events get the IGNORE policy (no create, no update).
                       */
                       export function getEventPolicy(eventType: string): JumpsellerEventPolicy {
                         return POLICIES[eventType] ?? IGNORE_POLICY;
                         }

                         /**
                          * Returns true if this event type is one we handle at all.
                           * Events outside this set are acknowledged with 200 and ignored.
                            */
                            export function isKnownEvent(eventType: string): boolean {
                              return eventType in POLICIES;
                              }

                              /**
                               * All event types that can trigger deal creation.
                                * Used for routing decisions in the webhook handler.
                                 */
                                 export const CREATOR_EVENTS: ReadonlyArray<string> = Object.entries(POLICIES)
                                   .filter(([, p]) => p.canCreate)
                                     .map(([evt]) => evt);

                                     /**
                                      * All event types that this handler accepts (known + handled).
                                       */
                                       export const HANDLED_EVENTS: ReadonlyArray<string> = Object.keys(POLICIES);
                                       

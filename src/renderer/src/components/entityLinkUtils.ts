export interface GenericEntityLink {
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
}

export function isMapObjectEntityReference(entityType: unknown): boolean {
  return String(entityType || '') === 'map_object';
}

export function getCounterpartyEntityType(link: GenericEntityLink, ownerEntityType: string, ownerEntityId: string): string {
  const isReverse = link.targetEntityType === ownerEntityType && link.targetEntityId === ownerEntityId;
  return isReverse ? link.sourceEntityType : link.targetEntityType;
}

export function getCounterpartyEntityId(link: GenericEntityLink, ownerEntityType: string, ownerEntityId: string): string {
  const isReverse = link.targetEntityType === ownerEntityType && link.targetEntityId === ownerEntityId;
  return isReverse ? link.sourceEntityId : link.targetEntityId;
}

export function shouldHideGenericEntityLink(link: GenericEntityLink, ownerEntityType: string, ownerEntityId: string): boolean {
  return isMapObjectEntityReference(getCounterpartyEntityType(link, ownerEntityType, ownerEntityId));
}

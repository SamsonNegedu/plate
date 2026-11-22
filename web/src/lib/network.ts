interface Connection {
  saveData?: boolean;
  effectiveType?: string;
}

/** True on a metered or very slow connection, where an 18 MB first-use download deserves a question first. */
export function constrainedNetwork(): boolean {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (!connection) return false;
  return (
    connection.saveData === true ||
    connection.effectiveType === "slow-2g" ||
    connection.effectiveType === "2g"
  );
}

/**
 * Motor RBAC declarativo — privilegios granulares por bitmask.
 * Cada nodo lógico ocupa un bit; los módulos futuros extienden la tabla.
 */

const PRIV = {
    DASHBOARD_VIEW:        1 << 0,
    SLOTS_VIEW:            1 << 1,
    SLOTS_CREATE:          1 << 2,
    SLOTS_EDIT:            1 << 3,
    SLOTS_DELETE:          1 << 4,
    RESERVATIONS_VIEW:     1 << 5,
    RESERVATIONS_CHECKIN:  1 << 6,
    RESERVATIONS_EXPORT:   1 << 7,
    QRS_VIEW:              1 << 8,
    QRS_CREATE:            1 << 9,
    QRS_EDIT:              1 << 10,
    QRS_DELETE:            1 << 11,
    CATEGORIES_VIEW:       1 << 12,
    CATEGORIES_MANAGE:     1 << 13,
    PRAYERS_VIEW:          1 << 14,
    PRAYERS_MANAGE:        1 << 15,
    ROLES_VIEW:            1 << 16,
    ROLES_MANAGE:          1 << 17,
    USERS_VIEW:            1 << 18,
    USERS_MANAGE:          1 << 19,
    AUDIT_VIEW:            1 << 20,
    CAPTAIN_VIEW:          1 << 21,
    CAPTAIN_ASSIGN:        1 << 22,
    MURO_VIEW:             1 << 23,
    MURO_MANAGE:           1 << 24,
};

const ALL_PRIVILEGES = Object.values(PRIV).reduce((acc, bit) => acc | bit, 0);

/** Conjuntos predefinidos para roles de sistema y compatibilidad legacy. */
const LECTOR_PRIVILEGES =
    PRIV.DASHBOARD_VIEW |
    PRIV.SLOTS_VIEW |
    PRIV.RESERVATIONS_VIEW |
    PRIV.RESERVATIONS_EXPORT |
    PRIV.QRS_VIEW |
    PRIV.MURO_VIEW;

const ADMIN_PRIVILEGES =
    LECTOR_PRIVILEGES |
    PRIV.SLOTS_CREATE |
    PRIV.SLOTS_EDIT |
    PRIV.RESERVATIONS_CHECKIN |
    PRIV.QRS_CREATE |
    PRIV.QRS_EDIT |
    PRIV.CAPTAIN_ASSIGN |
    PRIV.MURO_MANAGE;

/** Perfil limitado: solo ve y gestiona su bloque asignado. */
const CAPTAIN_PRIVILEGES =
    PRIV.CAPTAIN_VIEW |
    PRIV.DASHBOARD_VIEW |
    PRIV.SLOTS_VIEW |
    PRIV.RESERVATIONS_VIEW |
    PRIV.RESERVATIONS_CHECKIN;

const LEGACY_ROLE_PRIVILEGES = {
    feligres: 0,
    lector: LECTOR_PRIVILEGES,
    admin: ADMIN_PRIVILEGES,
    superadmin: ALL_PRIVILEGES,
};

/** Metadatos de nodos para la UI de creación de perfiles. */
const PERMISSION_NODES = [
    {
        module: 'dashboard',
        label: 'Centro de Mando',
        nodes: [
            { key: 'DASHBOARD_VIEW', bit: PRIV.DASHBOARD_VIEW, label: 'Ver resumen y métricas' },
        ],
    },
    {
        module: 'slots',
        label: 'Bloques Horarios',
        nodes: [
            { key: 'SLOTS_VIEW', bit: PRIV.SLOTS_VIEW, label: 'Ver turnos' },
            { key: 'SLOTS_CREATE', bit: PRIV.SLOTS_CREATE, label: 'Crear turnos' },
            { key: 'SLOTS_EDIT', bit: PRIV.SLOTS_EDIT, label: 'Editar / activar turnos' },
            { key: 'SLOTS_DELETE', bit: PRIV.SLOTS_DELETE, label: 'Eliminar turnos' },
        ],
    },
    {
        module: 'reservations',
        label: 'Reservas',
        nodes: [
            { key: 'RESERVATIONS_VIEW', bit: PRIV.RESERVATIONS_VIEW, label: 'Ver reservas' },
            { key: 'RESERVATIONS_CHECKIN', bit: PRIV.RESERVATIONS_CHECKIN, label: 'Marcar asistencia' },
            { key: 'RESERVATIONS_EXPORT', bit: PRIV.RESERVATIONS_EXPORT, label: 'Exportar CSV' },
        ],
    },
    {
        module: 'muro',
        label: 'Muro de intenciones',
        nodes: [
            { key: 'MURO_VIEW', bit: PRIV.MURO_VIEW, label: 'Ver muro en el panel' },
            { key: 'MURO_MANAGE', bit: PRIV.MURO_MANAGE, label: 'Editar, marcar oradas y eliminar' },
        ],
    },
    {
        module: 'qrs',
        label: 'QR de Capilla',
        nodes: [
            { key: 'QRS_VIEW', bit: PRIV.QRS_VIEW, label: 'Ver códigos QR' },
            { key: 'QRS_CREATE', bit: PRIV.QRS_CREATE, label: 'Generar QR' },
            { key: 'QRS_EDIT', bit: PRIV.QRS_EDIT, label: 'Editar / activar QR' },
            { key: 'QRS_DELETE', bit: PRIV.QRS_DELETE, label: 'Desactivar QR (soft delete)' },
        ],
    },
    {
        module: 'categories',
        label: 'Categorías Litúrgicas',
        nodes: [
            { key: 'CATEGORIES_VIEW', bit: PRIV.CATEGORIES_VIEW, label: 'Ver categorías' },
            { key: 'CATEGORIES_MANAGE', bit: PRIV.CATEGORIES_MANAGE, label: 'Gestionar categorías' },
        ],
    },
    {
        module: 'prayers',
        label: 'Biblioteca de Oraciones',
        nodes: [
            { key: 'PRAYERS_VIEW', bit: PRIV.PRAYERS_VIEW, label: 'Ver oraciones' },
            { key: 'PRAYERS_MANAGE', bit: PRIV.PRAYERS_MANAGE, label: 'Gestionar oraciones' },
        ],
    },
    {
        module: 'rbac',
        label: 'Control de Acceso',
        nodes: [
            { key: 'ROLES_VIEW', bit: PRIV.ROLES_VIEW, label: 'Ver perfiles' },
            { key: 'ROLES_MANAGE', bit: PRIV.ROLES_MANAGE, label: 'Crear y editar perfiles' },
            { key: 'USERS_VIEW', bit: PRIV.USERS_VIEW, label: 'Ver administradores' },
            { key: 'USERS_MANAGE', bit: PRIV.USERS_MANAGE, label: 'Asignar perfiles a usuarios' },
            { key: 'AUDIT_VIEW', bit: PRIV.AUDIT_VIEW, label: 'Consola de auditoría' },
        ],
    },
    {
        module: 'captains',
        label: 'Capitanes de bloque',
        nodes: [
            { key: 'CAPTAIN_VIEW', bit: PRIV.CAPTAIN_VIEW, label: 'Panel de mi bloque' },
            { key: 'CAPTAIN_ASSIGN', bit: PRIV.CAPTAIN_ASSIGN, label: 'Asignar capitanes a franjas' },
        ],
    },
];

function hasPermission(privileges, required) {
    return (privileges & required) === required;
}

function hasAnyPermission(privileges, ...required) {
    return required.some((bit) => hasPermission(privileges, bit));
}

function privilegesFromKeys(keys) {
    if (!Array.isArray(keys)) return 0;
    return keys.reduce((mask, key) => mask | (PRIV[key] || 0), 0);
}

function decodePrivileges(privileges) {
    const active = [];
    for (const group of PERMISSION_NODES) {
        for (const node of group.nodes) {
            if (hasPermission(privileges, node.bit)) {
                active.push(node.key);
            }
        }
    }
    return active;
}

module.exports = {
    PRIV,
    ALL_PRIVILEGES,
    LECTOR_PRIVILEGES,
    ADMIN_PRIVILEGES,
    CAPTAIN_PRIVILEGES,
    LEGACY_ROLE_PRIVILEGES,
    PERMISSION_NODES,
    hasPermission,
    hasAnyPermission,
    privilegesFromKeys,
    decodePrivileges,
};

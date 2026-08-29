'use strict';

/**
 * Selection du driver de stockage.
 *
 * Tout le reste du code importe ce module et ignore ou vivent les octets.
 * C'est ce qui permettra d'ajouter S3 en ecrivant un seul fichier de plus,
 * sans toucher au televersement, au transcodage ni a la diffusion.
 */

const config = require('../config');

const DRIVERS = {
  local: () => require('./local'),
  // s3: () => require('./s3'),   // branche quand le besoin se presentera
};

const make = DRIVERS[config.storage.driver];
if (!make) {
  throw new Error(
    `STORAGE_DRIVER inconnu : « ${config.storage.driver} ». Valeurs possibles : ${Object.keys(DRIVERS).join(', ')}.`,
  );
}

module.exports = make();

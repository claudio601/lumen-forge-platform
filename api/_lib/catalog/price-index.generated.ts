// AUTO-GENERADO por scripts/sync-jumpseller.ts. NO EDITAR A MANO.
// Índice de precios CON IVA para recalcular en el servidor (api/). Sin dependencias de src/.
// Fuente: API de Jumpseller (productos disponibles). Regenerar: npm run sync:catalog -- --write

export interface PriceIndexEntry {
  name: string;
  sku: string;
  price: number;
  variants: Record<string, { sku: string; price: number }>;
}

export const SNAPSHOT_HASH = '60bd699dc821';

export const priceIndex: Readonly<Record<string, PriceIndexEntry>> = {
  "2251059": {
    "name": "AMPOLLETA LED BOLA 9W E27",
    "sku": "",
    "price": 1200,
    "variants": {
      "94680903": {
        "sku": "ALE9C",
        "price": 1200
      },
      "94680904": {
        "sku": "ALE9F",
        "price": 1200
      }
    }
  },
  "2251313": {
    "name": "AMPOLLETA LED DICROICO 4W GU10",
    "sku": "",
    "price": 990,
    "variants": {
      "4160760": {
        "sku": "ALE4GC",
        "price": 990
      },
      "4160761": {
        "sku": "ALE4GF",
        "price": 990
      }
    }
  },
  "2252771": {
    "name": "PROYECTOR LED ANTIVANDÁLICO 50W IP66",
    "sku": "",
    "price": 11570,
    "variants": {
      "4160802": {
        "sku": "CHIPX50NC",
        "price": 11570
      },
      "4160803": {
        "sku": "CHIPX50NF",
        "price": 11570
      }
    }
  },
  "2252959": {
    "name": "PROYECTOR LED ANTIVANDÁLICO 70W IP66",
    "sku": "CHIPX70NF",
    "price": 20150,
    "variants": {}
  },
  "2252962": {
    "name": "PROYECTOR LED ANTIVANDÁLICO 100W IP66",
    "sku": "",
    "price": 32500,
    "variants": {
      "4160895": {
        "sku": "CHIPX100NC",
        "price": 32500
      },
      "4160896": {
        "sku": "CHIPX100NF",
        "price": 32500
      }
    }
  },
  "2254279": {
    "name": "PROYECTOR LED ANTIVANDÁLICO 150W IP66",
    "sku": "CHIPX150",
    "price": 49400,
    "variants": {}
  },
  "2254290": {
    "name": "PROYECTOR LED ANTIVANDÁLICO 200W IP66",
    "sku": "CHIPX200",
    "price": 62400,
    "variants": {}
  },
  "2255252": {
    "name": "FUENTE DE PODER SWITCHING 30W 12V 2.5A INTERIOR PERFORADA",
    "sku": "FU30I",
    "price": 5990,
    "variants": {}
  },
  "2255253": {
    "name": "FUENTE DE PODER SWITCHING 60W 12V 5A INTERIOR PERFORADA",
    "sku": "FU60I",
    "price": 8160,
    "variants": {}
  },
  "2255432": {
    "name": "FUENTE DE PODER SWITCHING 30W 12V 2.5A EXTERIOR IP67",
    "sku": "FU30E",
    "price": 9860,
    "variants": {}
  },
  "2255498": {
    "name": "FUENTE DE PODER SWITCHING 100W 12V 8.5A EXTERIOR IP67",
    "sku": "FU100E",
    "price": 22950,
    "variants": {}
  },
  "2255526": {
    "name": "FUENTE DE PODER SWITCHING 60W 12V 5A EXTERIOR IP67",
    "sku": "FU60E",
    "price": 14160,
    "variants": {}
  },
  "2255673": {
    "name": "FUENTE DE PODER SWITCHING 200W 12V 16.5A EXTERIOR IP67",
    "sku": "FU200E",
    "price": 25740,
    "variants": {}
  },
  "2255707": {
    "name": "FUENTE DE PODER SWITCHING 100W 12V 8A INTERIOR PERFORADA",
    "sku": "FU100I",
    "price": 11560,
    "variants": {}
  },
  "2255731": {
    "name": "FUENTE DE PODER SWITCHING 120W 12V 10A INTERIOR PERFORADA",
    "sku": "FU120I",
    "price": 14960,
    "variants": {}
  },
  "2255735": {
    "name": "FUENTE DE PODER SWITCHING 150W 12V 12.5A INTERIOR PERFORADA",
    "sku": "FU150I",
    "price": 20700,
    "variants": {}
  },
  "2255737": {
    "name": "FUENTE DE PODER SWITCHING 200W 12V 16.6A INTERIOR PERFORADA",
    "sku": "FU200I",
    "price": 19500,
    "variants": {}
  },
  "2255747": {
    "name": "FUENTE DE PODER SWITCHING 360W 12V 30A INTERIOR PERFORADA",
    "sku": "FU360I",
    "price": 37400,
    "variants": {}
  },
  "2255899": {
    "name": "PANEL LED REDONDO EMBUTIDO 3W IP44",
    "sku": "",
    "price": 1390,
    "variants": {
      "94978029": {
        "sku": "PLRE3C",
        "price": 1390
      },
      "120884238": {
        "sku": "PLRE3N",
        "price": 1390
      },
      "120884239": {
        "sku": "PLRE3F",
        "price": 1390
      }
    }
  },
  "2255963": {
    "name": "PANEL LED REDONDO EMBUTIDO 6W IP44",
    "sku": "",
    "price": 1740,
    "variants": {
      "94980260": {
        "sku": "PLRE6C",
        "price": 1740
      },
      "120885636": {
        "sku": "PLRE6N",
        "price": 1740
      },
      "120885639": {
        "sku": "PLRE6F",
        "price": 1740
      }
    }
  },
  "2256011": {
    "name": "PANEL LED REDONDO EMBUTIDO 9W IP44",
    "sku": "",
    "price": 2490,
    "variants": {
      "94980570": {
        "sku": "PLRE9C",
        "price": 2490
      },
      "120885493": {
        "sku": "PLRE9N",
        "price": 2490
      },
      "120885496": {
        "sku": "PLRE9F",
        "price": 2490
      }
    }
  },
  "2268808": {
    "name": "PANEL LED REDONDO EMBUTIDO 12W IP44",
    "sku": "",
    "price": 2420,
    "variants": {
      "94985727": {
        "sku": "PLRE12C",
        "price": 2420
      },
      "120885505": {
        "sku": "PLRE12N",
        "price": 2420
      },
      "120885508": {
        "sku": "PLRE12F",
        "price": 2420
      }
    }
  },
  "2268816": {
    "name": "PANEL LED REDONDO EMBUTIDO 24W IP44",
    "sku": "",
    "price": 5020,
    "variants": {
      "95081689": {
        "sku": "PLRE24C",
        "price": 5020
      },
      "120885628": {
        "sku": "PLRE24N",
        "price": 5020
      },
      "120885631": {
        "sku": "PLRE24F",
        "price": 5020
      }
    }
  },
  "2269032": {
    "name": "PANEL LED REDONDO EMBUTIDO 15W IP44",
    "sku": "",
    "price": 2790,
    "variants": {
      "95018431": {
        "sku": "PLRE15C",
        "price": 2790
      },
      "120885644": {
        "sku": "PLRE15N",
        "price": 2790
      },
      "120885647": {
        "sku": "PLRE15F",
        "price": 2790
      }
    }
  },
  "2269355": {
    "name": "PANEL LED REDONDO SOBREPUESTO 6W IP44",
    "sku": "",
    "price": 2100,
    "variants": {
      "94980013": {
        "sku": "",
        "price": 2100
      },
      "120884787": {
        "sku": "",
        "price": 2100
      },
      "120885521": {
        "sku": "",
        "price": 2100
      }
    }
  },
  "2269456": {
    "name": "PANEL LED REDONDO SOBREPUESTO 9W IP44",
    "sku": "",
    "price": 2890,
    "variants": {
      "95314431": {
        "sku": "",
        "price": 2890
      },
      "120885487": {
        "sku": "",
        "price": 2890
      },
      "120885489": {
        "sku": "",
        "price": 2890
      }
    }
  },
  "2269468": {
    "name": "PANEL LED REDONDO SOBREPUESTO 12W IP44",
    "sku": "",
    "price": 3000,
    "variants": {
      "6701576": {
        "sku": "PLRS12N",
        "price": 3000
      },
      "120885517": {
        "sku": "",
        "price": 3000
      },
      "120885520": {
        "sku": "",
        "price": 3000
      }
    }
  },
  "2269493": {
    "name": "PANEL LED REDONDO SOBREPUESTO 18W IP44 REGULABLE",
    "sku": "",
    "price": 15000,
    "variants": {
      "95081793": {
        "sku": "",
        "price": 15000
      },
      "120885592": {
        "sku": "",
        "price": 15000
      },
      "120885595": {
        "sku": "",
        "price": 15000
      }
    }
  },
  "2269544": {
    "name": "PANEL LED REDONDO SOBREPUESTO 24W IP44",
    "sku": "",
    "price": 5900,
    "variants": {
      "95082356": {
        "sku": "",
        "price": 5900
      },
      "120885534": {
        "sku": "",
        "price": 5900
      },
      "120885537": {
        "sku": "",
        "price": 5900
      }
    }
  },
  "2269646": {
    "name": "PANEL LED CUADRADO EMBUTIDO 3W IP20",
    "sku": "",
    "price": 1990,
    "variants": {
      "95288390": {
        "sku": "",
        "price": 1990
      },
      "120885597": {
        "sku": "",
        "price": 1990
      },
      "120885599": {
        "sku": "",
        "price": 1990
      }
    }
  },
  "2270107": {
    "name": "PANEL LED CUADRADO EMBUTIDO 4W IP20",
    "sku": "",
    "price": 2200,
    "variants": {
      "4160970": {
        "sku": "PLCE4F",
        "price": 2200
      },
      "120885601": {
        "sku": "",
        "price": 2200
      },
      "120885603": {
        "sku": "",
        "price": 2200
      }
    }
  },
  "2270155": {
    "name": "PANEL LED CUADRADO EMBUTIDO 12W IP20",
    "sku": "",
    "price": 3497,
    "variants": {
      "4163193": {
        "sku": "PLCE12F",
        "price": 3497
      },
      "120885498": {
        "sku": "",
        "price": 3497
      },
      "120885501": {
        "sku": "",
        "price": 3497
      }
    }
  },
  "2270214": {
    "name": "PANEL LED CUADRADO EMBUTIDO 18W IP44",
    "sku": "",
    "price": 3600,
    "variants": {
      "95091077": {
        "sku": "",
        "price": 3600
      },
      "120885610": {
        "sku": "",
        "price": 3600
      },
      "120885613": {
        "sku": "",
        "price": 3600
      }
    }
  },
  "2270233": {
    "name": "PANEL LED CUADRADO EMBUTIDO 24W IP44",
    "sku": "",
    "price": 6300,
    "variants": {
      "95236943": {
        "sku": "",
        "price": 6300
      },
      "120885618": {
        "sku": "",
        "price": 6300
      },
      "120885621": {
        "sku": "",
        "price": 6300
      }
    }
  },
  "2270276": {
    "name": "PANEL LED CUADRADO SOBREPUESTO 6W IP44",
    "sku": "",
    "price": 1800,
    "variants": {
      "94979071": {
        "sku": "",
        "price": 1800
      },
      "120885622": {
        "sku": "",
        "price": 1800
      },
      "120885625": {
        "sku": "",
        "price": 1800
      }
    }
  },
  "2270564": {
    "name": "PANEL LED CUADRADO SOBREPUESTO 12W IP44",
    "sku": "",
    "price": 2900,
    "variants": {
      "94988327": {
        "sku": "",
        "price": 2900
      },
      "120885511": {
        "sku": "",
        "price": 2900
      },
      "120885514": {
        "sku": "",
        "price": 2900
      }
    }
  },
  "2270590": {
    "name": "PANEL LED CUADRADO SOBREPUESTO 18W IP44",
    "sku": "",
    "price": 3500,
    "variants": {
      "95082060": {
        "sku": "",
        "price": 3500
      },
      "120885530": {
        "sku": "",
        "price": 3500
      },
      "120885533": {
        "sku": "",
        "price": 3500
      }
    }
  },
  "2270621": {
    "name": "PANEL LED CUADRADO SOBREPUESTO 24W IP44",
    "sku": "",
    "price": 7500,
    "variants": {
      "95082234": {
        "sku": "",
        "price": 7500
      },
      "120885540": {
        "sku": "",
        "price": 7500
      },
      "120885543": {
        "sku": "",
        "price": 7500
      }
    }
  },
  "2282982": {
    "name": "PANEL LED CONCENTRICO OPAL 10W IP20",
    "sku": "",
    "price": 7900,
    "variants": {
      "94905391": {
        "sku": "",
        "price": 7900
      },
      "94905392": {
        "sku": "",
        "price": 7900
      },
      "94905393": {
        "sku": "",
        "price": 7900
      }
    }
  },
  "2283811": {
    "name": "PANEL LED CONCENTRICO OPAL 15W IP33",
    "sku": "",
    "price": 10900,
    "variants": {
      "94905373": {
        "sku": "",
        "price": 10900
      },
      "94905374": {
        "sku": "",
        "price": 10900
      },
      "94905375": {
        "sku": "",
        "price": 10900
      }
    }
  },
  "2283850": {
    "name": "PANEL LED CONCENTRICO OPAL 30W IP33",
    "sku": "",
    "price": 15990,
    "variants": {
      "94905450": {
        "sku": "",
        "price": 15990
      },
      "94905451": {
        "sku": "",
        "price": 15990
      },
      "94905452": {
        "sku": "",
        "price": 15990
      }
    }
  },
  "2284560": {
    "name": "FOCO LED COB BASCULANTE 5W IP44 MARCO BLANCO",
    "sku": "M160-32",
    "price": 5320,
    "variants": {
      "4165318": {
        "sku": "FLCB5BC",
        "price": 5320
      },
      "4165319": {
        "sku": "FLCB5BF",
        "price": 5320
      }
    }
  },
  "2286835": {
    "name": "FOCO LED COB BASCULANTE CODO 30W IP33",
    "sku": "FLCBC30F",
    "price": 24900,
    "variants": {
      "105152274": {
        "sku": "FLCBC30F",
        "price": 24900
      },
      "105152275": {
        "sku": "FLCBC30N",
        "price": 24900
      },
      "118438897": {
        "sku": "",
        "price": 24900
      }
    }
  },
  "2291780": {
    "name": "PROYECTOR LED EMPOTRADO A MURO BASCULANTE 35W IP44",
    "sku": "",
    "price": 25740,
    "variants": {
      "4175919": {
        "sku": "PLEMB35C",
        "price": 25740
      },
      "6043276": {
        "sku": "PLEMB35N",
        "price": 25740
      },
      "6043290": {
        "sku": "PLEMB35F",
        "price": 25740
      }
    }
  },
  "2292318": {
    "name": "PROYECTOR LED COB 20W GRIS IP65",
    "sku": "CHIPX50N",
    "price": 5800,
    "variants": {
      "4176509": {
        "sku": "PLC20GC",
        "price": 5800
      }
    }
  },
  "2292375": {
    "name": "PROYECTOR LED COB 30W GRIS IP65",
    "sku": "CHIPX50N",
    "price": 8800,
    "variants": {
      "4176583": {
        "sku": "PLC30GC",
        "price": 8800
      }
    }
  },
  "2292456": {
    "name": "PROYECTOR LED COB 70W GRIS IP65",
    "sku": "CHIPX50N",
    "price": 18000,
    "variants": {
      "4176671": {
        "sku": "PLC70GC",
        "price": 18000
      },
      "4176672": {
        "sku": "PLC70GF",
        "price": 18000
      }
    }
  },
  "2293220": {
    "name": "PROYECTOR LED COB 120W GRIS IP65",
    "sku": "",
    "price": 22500,
    "variants": {}
  },
  "2293388": {
    "name": "PROYECTOR LED RGB 20W IP66 NEGRO",
    "sku": "PLCRGB20N",
    "price": 16560,
    "variants": {}
  },
  "2293445": {
    "name": "PROYECTOR LED COB 50W GRIS IP65 CON SENSOR DE MOVIMIENTO",
    "sku": "PLC50GC",
    "price": 13000,
    "variants": {}
  },
  "2293796": {
    "name": "PROYECTOR LED DE EMERGENCIA RECARGABLE SMD 20W IP66",
    "sku": "PLER20F",
    "price": 31200,
    "variants": {}
  },
  "2293830": {
    "name": "PROYECTOR LED DE EMERGENCIA RECARGABLE SMD 30W IP66",
    "sku": "PLER30F",
    "price": 46680,
    "variants": {}
  },
  "2293849": {
    "name": "PROYECTOR LED DE EMERGENCIA RECARGABLE SMD 50W IP66",
    "sku": "PLER50F",
    "price": 57000,
    "variants": {}
  },
  "2294706": {
    "name": "PANEL LED 60X30 CM. 36W PARA CIELO AMERICANO",
    "sku": "",
    "price": 14900,
    "variants": {
      "95663094": {
        "sku": "",
        "price": 14900
      },
      "103678744": {
        "sku": "",
        "price": 14900
      },
      "103678745": {
        "sku": "",
        "price": 14900
      }
    }
  },
  "2295723": {
    "name": "PROYECTOR LED ULTRA THIN SMD 10W IP66 NEGRO",
    "sku": "",
    "price": 3190,
    "variants": {
      "4180522": {
        "sku": "PLUTSMD10NF",
        "price": 3190
      },
      "88623122": {
        "sku": "PLUTSMD10NN",
        "price": 3190
      }
    }
  },
  "2300759": {
    "name": "TUBO LED T8 OPAL VIDRIO 9W 60CM 220V",
    "sku": "",
    "price": 1390,
    "variants": {
      "4186062": {
        "sku": "TLV9220C",
        "price": 1390
      },
      "4186063": {
        "sku": "TLV9220N",
        "price": 1390
      },
      "4186064": {
        "sku": "TLV9220F",
        "price": 1390
      }
    }
  },
  "2300762": {
    "name": "TUBO LED T8 OPAL VIDRIO 18W 120CM. 220V",
    "sku": "",
    "price": 1500,
    "variants": {
      "4186073": {
        "sku": "TLV18220C",
        "price": 1500
      },
      "4186074": {
        "sku": "TLV18220N",
        "price": 1500
      },
      "4186075": {
        "sku": "TLV18220F",
        "price": 1500
      }
    }
  },
  "2300809": {
    "name": "TUBO LED OPAL ALUMINIO 9W 60CM. 220V.",
    "sku": "",
    "price": 3250,
    "variants": {
      "4186125": {
        "sku": "TLOA9W60220VC",
        "price": 3250
      },
      "6699334": {
        "sku": "TLOA9W60220VF",
        "price": 3250
      }
    }
  },
  "2300821": {
    "name": "TUBO LED OPAL ALUMINIO 18W 120 CM. 220V",
    "sku": "",
    "price": 2990,
    "variants": {
      "4186140": {
        "sku": "TLOA18W120220VF",
        "price": 2990
      },
      "4186293": {
        "sku": "TLOA18W120220VC",
        "price": 2990
      },
      "4186294": {
        "sku": "TLOA18W120220VN",
        "price": 2990
      }
    }
  },
  "2300837": {
    "name": "TUBO LED OPAL VIDRIO 18W 120CM. 220V. C/ SENSOR 6500K",
    "sku": "TLOV18W120220VS",
    "price": 8160,
    "variants": {}
  },
  "2300850": {
    "name": "TUBO LED OPAL ALUMINIO 9W 60CM. 24V 6500K",
    "sku": "TLOV9W",
    "price": 8330,
    "variants": {}
  },
  "2300869": {
    "name": "TUBO LED OPAL ALUMINIO 9W 60CM. 12V",
    "sku": "TLOA9W6012V",
    "price": 8330,
    "variants": {}
  },
  "2300874": {
    "name": "TUBO LED OPAL ALUMINIO 18W 120CM. 12V",
    "sku": "TLOA18W12012V",
    "price": 9190,
    "variants": {}
  },
  "2300879": {
    "name": "TUBO LED OPAL ALUMINIO 24W 150CM. 220V",
    "sku": "",
    "price": 7990,
    "variants": {
      "4186306": {
        "sku": "TLOA24150220VC",
        "price": 7990
      },
      "4186307": {
        "sku": "TLOA24150220VN",
        "price": 7990
      },
      "4186308": {
        "sku": "TLOA24150220VF",
        "price": 7990
      }
    }
  },
  "2300889": {
    "name": "TUBO LED VIDRIO TRANSPARENTE 9W 60CM. 220V LUZ CÁLIDA",
    "sku": "TLVT9W60220V",
    "price": 1990,
    "variants": {}
  },
  "2301098": {
    "name": "ALUMBRADO PÚBLICO BESTLED 40W IP66 IK08",
    "sku": "",
    "price": 108500,
    "variants": {
      "95224064": {
        "sku": "APB40N",
        "price": 108500
      },
      "95224065": {
        "sku": "APB40F",
        "price": 108500
      },
      "111887367": {
        "sku": "APB401",
        "price": 119400
      },
      "111887368": {
        "sku": "APB407",
        "price": 119400
      }
    }
  },
  "2301101": {
    "name": "ALUMBRADO PÚBLICO BESTLED 60W IP66 IK08",
    "sku": "",
    "price": 118500,
    "variants": {
      "8853471": {
        "sku": "APB60N",
        "price": 118500
      },
      "107574432": {
        "sku": "APB601",
        "price": 130400
      },
      "107574433": {
        "sku": "APB607",
        "price": 130400
      },
      "111887332": {
        "sku": "APB60F",
        "price": 118500
      }
    }
  },
  "2301105": {
    "name": "ALUMBRADO PÚBLICO BESTLED 90W IP66 IK08",
    "sku": "",
    "price": 139900,
    "variants": {
      "95224200": {
        "sku": "APB90N",
        "price": 139900
      },
      "111887900": {
        "sku": "APB907",
        "price": 154000
      },
      "111887901": {
        "sku": "APB901",
        "price": 154000
      },
      "111887902": {
        "sku": "APB90F",
        "price": 139900
      }
    }
  },
  "2301110": {
    "name": "ALUMBRADO PÚBLICO BESTLED 120W IP66 IK08",
    "sku": "",
    "price": 167800,
    "variants": {
      "95224226": {
        "sku": "APB120N",
        "price": 167800
      },
      "116896283": {
        "sku": "APB1201",
        "price": 184600
      },
      "116896284": {
        "sku": "APB1207",
        "price": 184600
      },
      "116896285": {
        "sku": "APB120F",
        "price": 167800
      }
    }
  },
  "2301114": {
    "name": "ALUMBRADO PÚBLICO BESTLED 200W IP66 IK08",
    "sku": "",
    "price": 225700,
    "variants": {
      "95224533": {
        "sku": "APB200N",
        "price": 225700
      },
      "95224534": {
        "sku": "APB200F",
        "price": 225700
      },
      "116897113": {
        "sku": "APB2001",
        "price": 248400
      },
      "116897114": {
        "sku": "APB2007",
        "price": 248400
      }
    }
  },
  "2307410": {
    "name": "CAMPANA LED UFO IP65 PREMIUM GRIS 150W",
    "sku": "UFOP150F",
    "price": 94800,
    "variants": {}
  },
  "2312822": {
    "name": "CINTA LED INTERIOR 14.4W SMD 5050 60LEDs/m 5MT. 12V. LUZ CÁLIDA",
    "sku": "CLI505012VC",
    "price": 8900,
    "variants": {}
  },
  "2313541": {
    "name": "CINTA LED EXTERIOR 14.4W SMD 5050 60LEDs/m 5MT. 12V. LUZ FRÍA",
    "sku": "CLE505012VF",
    "price": 10990,
    "variants": {}
  },
  "2313620": {
    "name": "CINTA LED INTERIOR 14.4W SMD 5050 60LEDs/m 5mt. 12V. ROJO",
    "sku": "CLI50506012VR",
    "price": 8900,
    "variants": {}
  },
  "2313626": {
    "name": "CINTA LED INTERIOR 14.4W SMD 5050 60LEDs/m 5mt. 12V. AZUL",
    "sku": "CLI50506012VA",
    "price": 8900,
    "variants": {}
  },
  "2313647": {
    "name": "CINTA LED INTERIOR 14.4W SMD 5050 60LEDs/m 5mt. 12V. VERDE",
    "sku": "CLI50506012VV",
    "price": 10900,
    "variants": {}
  },
  "2313648": {
    "name": "CINTA LED INTERIOR 14.4W SMD 5050 60LEDs/m 5mt. 12V. AMARILLO",
    "sku": "CLI50506012VAM",
    "price": 8900,
    "variants": {}
  },
  "2313769": {
    "name": "CINTA LED EXTERIOR 14.4W SMD 5050 60LEDs/m 5MT. 12V. LUZ CÁLIDA",
    "sku": "CLE505012VC",
    "price": 12300,
    "variants": {}
  },
  "2313797": {
    "name": "CINTA LED INTERIOR 14.4W SMD 5050 60LEDs/m 5MT. 12V. LUZ FRÍA",
    "sku": "CLI505012VF",
    "price": 11044,
    "variants": {}
  },
  "2313836": {
    "name": "CINTA LED EXTERIOR 14.4W SMD 5050 60LEDs/m 5mt. 12V. ROJO",
    "sku": "CLE50506012VR",
    "price": 10990,
    "variants": {}
  },
  "2313842": {
    "name": "CINTA LED EXTERIOR 14.4W SMD 5050 60LEDs/m 5mt. 12V. AZUL",
    "sku": "CLE50506012VA",
    "price": 10990,
    "variants": {}
  },
  "2313858": {
    "name": "CINTA LED EXTERIOR 14.4W SMD 5050 60LEDs/m 5mt. 12V. VERDE",
    "sku": "CLE50506012VV",
    "price": 10990,
    "variants": {}
  },
  "2313868": {
    "name": "CINTA LED EXTERIOR 14.4W SMD 5050 60LEDs/m 5mt. 12V. AMARILLO",
    "sku": "CLE50506012VAM",
    "price": 10990,
    "variants": {}
  },
  "2326098": {
    "name": "LINEAL LED MULTIFUNCIÓN 40W 120 CM. IP44",
    "sku": "",
    "price": 23700,
    "variants": {
      "7324226": {
        "sku": "LLL40120C",
        "price": 23700
      },
      "7324228": {
        "sku": "LLL40120N",
        "price": 23700
      },
      "7324229": {
        "sku": "LLL40120F",
        "price": 23700
      }
    }
  },
  "2326680": {
    "name": "REGLETA LED T5 9W 60 CM. IP44",
    "sku": "",
    "price": 3640,
    "variants": {
      "4192710": {
        "sku": "RLT5960C",
        "price": 3640
      },
      "4192712": {
        "sku": "RLT5960F",
        "price": 3640
      }
    }
  },
  "2327026": {
    "name": "REGLETA LED T5 18W 120 CM. IP44",
    "sku": "",
    "price": 4550,
    "variants": {
      "4192897": {
        "sku": "RLT518120C",
        "price": 4550
      },
      "4192898": {
        "sku": "RLT518120F",
        "price": 4550
      }
    }
  },
  "2327095": {
    "name": "REGLETA LED T8 9W 60 CM. IP44",
    "sku": "LLLF40120CA",
    "price": 3790,
    "variants": {
      "4192987": {
        "sku": "RLT8960C",
        "price": 3790
      },
      "4192988": {
        "sku": "RLT8960F",
        "price": 3790
      }
    }
  },
  "2327131": {
    "name": "REGLETA LED T8 18W 120 CM. IP44",
    "sku": "LLLF40120CA",
    "price": 4990,
    "variants": {
      "4193016": {
        "sku": "RLT818120C",
        "price": 4990
      },
      "4193017": {
        "sku": "RLT818120F",
        "price": 4990
      }
    }
  },
  "2328732": {
    "name": "APLIQUE DECORATIVO BIDIRECCIONAL SEMI CIRCULO 2x5W IP65 NEGRO",
    "sku": "",
    "price": 17900,
    "variants": {
      "12612703": {
        "sku": "ADCE2X5NC",
        "price": 17900
      },
      "12612704": {
        "sku": "ADCE2X5NF",
        "price": 17900
      }
    }
  },
  "2339101": {
    "name": "AMPOLLETA LED AR111 15-150W 24° 1200 Lm. IP44",
    "sku": "",
    "price": 16200,
    "variants": {
      "4203853": {
        "sku": "ALAR11115F",
        "price": 16200
      }
    }
  },
  "2340383": {
    "name": "PROYECTOR LED SLIM SMD 300W IP66",
    "sku": "",
    "price": 88400,
    "variants": {
      "96644488": {
        "sku": "",
        "price": 88400
      },
      "96644489": {
        "sku": "",
        "price": 88400
      },
      "121250279": {
        "sku": "",
        "price": 88400
      },
      "121250280": {
        "sku": "",
        "price": 88400
      }
    }
  },
  "2340385": {
    "name": "PROYECTOR LED SLIM SMD 400W IP66",
    "sku": "PLSSMD400F",
    "price": 165600,
    "variants": {
      "121250397": {
        "sku": "PLSSMD400F",
        "price": 165600
      },
      "121250398": {
        "sku": "PLSSMD400F",
        "price": 165600
      },
      "121250399": {
        "sku": "PLSSMD400F",
        "price": 165600
      },
      "121250400": {
        "sku": "PLSSMD400F",
        "price": 165600
      }
    }
  },
  "2340468": {
    "name": "PROYECTOR LED SLIM SMD 30W IP66",
    "sku": "PLSSMD10",
    "price": 8840,
    "variants": {
      "4205118": {
        "sku": "PLSSMD30F",
        "price": 8840
      },
      "11927469": {
        "sku": "",
        "price": 8840
      }
    }
  },
  "2340483": {
    "name": "PROYECTOR LED SLIM SMD 50W IP66 LUZ FRÍA",
    "sku": "PLSSMD10",
    "price": 11570,
    "variants": {
      "4205128": {
        "sku": "PLSSMD50F",
        "price": 11570
      },
      "11927470": {
        "sku": "",
        "price": 11570
      }
    }
  },
  "2340515": {
    "name": "PROYECTOR LED SLIM SMD 150W IP66",
    "sku": "",
    "price": 41600,
    "variants": {
      "96644372": {
        "sku": "",
        "price": 41600
      },
      "96644373": {
        "sku": "",
        "price": 41600
      },
      "121250257": {
        "sku": "",
        "price": 41600
      },
      "121250258": {
        "sku": "",
        "price": 41600
      }
    }
  },
  "2340521": {
    "name": "PROYECTOR LED SLIM SMD 200W IP66",
    "sku": "",
    "price": 61750,
    "variants": {
      "96644410": {
        "sku": "",
        "price": 61750
      },
      "100857181": {
        "sku": "",
        "price": 61750
      },
      "121250275": {
        "sku": "",
        "price": 61750
      },
      "121250276": {
        "sku": "",
        "price": 61750
      }
    }
  },
  "2340625": {
    "name": "PROYECTOR LED SLIM SMD 100W IP66",
    "sku": "PLSSMD10",
    "price": 31429,
    "variants": {
      "4205286": {
        "sku": "PLSSMD100F",
        "price": 31429
      },
      "11927471": {
        "sku": "PLSSMD100C",
        "price": 31429
      }
    }
  },
  "2345055": {
    "name": "ESTACA MINI LED COB  5W JARDÍN IP65",
    "sku": "",
    "price": 6300,
    "variants": {
      "95315974": {
        "sku": "",
        "price": 6300
      },
      "114137501": {
        "sku": "",
        "price": 6300
      }
    }
  },
  "2345134": {
    "name": "RIEL MONOFÁSICO 1 MT.",
    "sku": "RM1MT",
    "price": 4300,
    "variants": {
      "4210740": {
        "sku": "RM1MTB",
        "price": 4300
      },
      "4210741": {
        "sku": "RM1MTN",
        "price": 4300
      }
    }
  },
  "2345138": {
    "name": "RIEL MONOFÁSICO 2 MT.",
    "sku": "RM1MT",
    "price": 8500,
    "variants": {
      "4210753": {
        "sku": "RM2MTB",
        "price": 8500
      },
      "4210754": {
        "sku": "RM2MTN",
        "price": 8500
      }
    }
  },
  "2345290": {
    "name": "TORTUGA LED 16W OPAL BLANCA LISA",
    "sku": "TL16PBL",
    "price": 9350,
    "variants": {
      "4210916": {
        "sku": "TL16PBLC",
        "price": 9350
      },
      "4210917": {
        "sku": "TL16PBLF",
        "price": 9350
      }
    }
  },
  "2345320": {
    "name": "TORTUGA ALUMINIO OVAL C/ REJILLA E27 IP54 BLANCA",
    "sku": "TAOCRE27",
    "price": 3990,
    "variants": {}
  },
  "2346900": {
    "name": "FOCO SUMERGIBLE PISCINA SOBREPUESTO 18W IP68 12V",
    "sku": "",
    "price": 55200,
    "variants": {
      "4213555": {
        "sku": "FSPS36C",
        "price": 55200
      },
      "4213556": {
        "sku": "FSPS36F",
        "price": 55200
      },
      "4213557": {
        "sku": "FSPS36RGB",
        "price": 55200
      }
    }
  },
  "2347029": {
    "name": "FOCO LED EMBUTIDO EN PISO 1W IP67",
    "sku": "",
    "price": 10900,
    "variants": {
      "95315043": {
        "sku": "",
        "price": 10900
      },
      "111913322": {
        "sku": "",
        "price": 10900
      }
    }
  },
  "2347032": {
    "name": "FOCO LED EMBUTIDO EN PISO 3W IP67",
    "sku": "",
    "price": 11900,
    "variants": {
      "4213632": {
        "sku": "FLEP3C",
        "price": 11900
      },
      "4213633": {
        "sku": "FLEP3F",
        "price": 11900
      }
    }
  },
  "2347102": {
    "name": "FOCO LED EMBUTIDO EN PISO 5W IP67",
    "sku": "",
    "price": 14200,
    "variants": {
      "95315223": {
        "sku": "",
        "price": 14200
      },
      "95315224": {
        "sku": "",
        "price": 14200
      }
    }
  },
  "2347159": {
    "name": "FOCO LED EMBUTIDO EN PISO 12W IP67",
    "sku": "",
    "price": 19900,
    "variants": {
      "95433611": {
        "sku": "",
        "price": 19900
      },
      "95433612": {
        "sku": "",
        "price": 19900
      }
    }
  },
  "2347175": {
    "name": "FOCO LED EMBUTIDO EN PISO 9W IP67",
    "sku": "",
    "price": 17900,
    "variants": {
      "4213947": {
        "sku": "FLEP9C",
        "price": 17900
      },
      "4213948": {
        "sku": "FLEP9F",
        "price": 17900
      }
    }
  },
  "2347772": {
    "name": "PANEL LED 120X60 CM. 80W PARA CIELO AMERICANO MARCO BLANCO",
    "sku": "",
    "price": 43100,
    "variants": {
      "4214389": {
        "sku": "PL12060BC",
        "price": 43100
      },
      "4214390": {
        "sku": "PL12060BN",
        "price": 43100
      },
      "4214391": {
        "sku": "PL12060BF",
        "price": 43100
      }
    }
  },
  "2347849": {
    "name": "PANEL LED 120X15 CM 36W. PARA CIELO AMERICANO",
    "sku": "",
    "price": 17100,
    "variants": {
      "4214610": {
        "sku": "PL12015BC",
        "price": 17100
      },
      "4214611": {
        "sku": "PL12015BN",
        "price": 17100
      },
      "4214612": {
        "sku": "PL12015BF",
        "price": 17100
      }
    }
  },
  "2347854": {
    "name": "PANEL LED 120X30 CM. 40W PARA CIELO AMERICANO",
    "sku": "",
    "price": 21900,
    "variants": {
      "4214619": {
        "sku": "PL12030BC",
        "price": 21900
      },
      "4214620": {
        "sku": "PL12030BN",
        "price": 21900
      },
      "4214621": {
        "sku": "PL12030BF",
        "price": 21900
      }
    }
  },
  "2348922": {
    "name": "PANEL LED 120X30 CM. 40W PARA CIELO AMERICANO MARCO BLANCO REGULABLE",
    "sku": "",
    "price": 41400,
    "variants": {
      "4215385": {
        "sku": "PL12030BDC",
        "price": 41400
      },
      "4215386": {
        "sku": "PL12030BDN",
        "price": 41400
      },
      "4215387": {
        "sku": "PL12030BDF",
        "price": 41400
      }
    }
  },
  "2348936": {
    "name": "PANEL LED 120X60 CM. 80W PARA CIELO AMERICANO MARCO BLANCO REGULABLE",
    "sku": "",
    "price": 79000,
    "variants": {
      "4215417": {
        "sku": "PL12060BDC",
        "price": 79000
      },
      "4215418": {
        "sku": "PL12060BDN",
        "price": 79000
      },
      "4215419": {
        "sku": "PL12060BDF",
        "price": 79000
      }
    }
  },
  "2352646": {
    "name": "LUMINARIA LED TRI-PROOF A PRUEBA DE EXPLOSIÓN ATEX 40W",
    "sku": "LLTPATPAX40",
    "price": 534700,
    "variants": {}
  },
  "2352650": {
    "name": "LUMINARIA LED TRI-PROOF A PRUEBA DE EXPLOSIÓN ATEX 60W",
    "sku": "LLTPATPAX60",
    "price": 551700,
    "variants": {}
  },
  "2354635": {
    "name": "DOWNLIGHT LED REDONDO EMBUTIDO 16W LUZ FRÍA NIQUEL",
    "sku": "",
    "price": 11900,
    "variants": {
      "95492370": {
        "sku": "DLRE16F",
        "price": 11900
      }
    }
  },
  "2354701": {
    "name": "DOWNLIGHT LED SOBREPUESTO CILINDRO 7W IP20",
    "sku": "DLS7LVB",
    "price": 7800,
    "variants": {
      "11927474": {
        "sku": "",
        "price": 7800
      },
      "11927475": {
        "sku": "",
        "price": 7800
      }
    }
  },
  "2396454": {
    "name": "Perfil de Aluminio Sobrepuesto para Cinta LED 3MT",
    "sku": "",
    "price": 6890,
    "variants": {
      "4232878": {
        "sku": "PASC2",
        "price": 6890
      }
    }
  },
  "2401941": {
    "name": "KIT DE EMERGENCIA LED 300W 120 MINUTOS AUTONOMIA",
    "sku": "SS300W",
    "price": 35760,
    "variants": {}
  },
  "2401982": {
    "name": "KIT DE EMERGENCIA LED 50W 120 MINUTOS DE AUTONOMIA",
    "sku": "SS50W",
    "price": 17400,
    "variants": {}
  },
  "2402075": {
    "name": "KIT DE INSTALACIÓN CABLES SUSPENDIDOS 1 MT. PARA PANELES",
    "sku": "KPX4",
    "price": 3770,
    "variants": {}
  },
  "2404499": {
    "name": "FUENTE DE PODER PARA FOCO PISCINA 60W 12V IP20",
    "sku": "FPFP6012V",
    "price": 16660,
    "variants": {}
  },
  "2418650": {
    "name": "PANEL LED REDONDO EMBUTIDO 18W CON SENSOR MOVIMIENTO IP33 BLANCO",
    "sku": "",
    "price": 10900,
    "variants": {
      "94997211": {
        "sku": "",
        "price": 10900
      },
      "120885648": {
        "sku": "",
        "price": 10900
      },
      "120885650": {
        "sku": "",
        "price": 10900
      }
    }
  },
  "2418983": {
    "name": "PANEL LED REDONDO SOBREPUESTO 18W CON SENSOR MOVIMIENTO  IP40",
    "sku": "PLRS18SB",
    "price": 11880,
    "variants": {
      "101025652": {
        "sku": "",
        "price": 11880
      },
      "120885587": {
        "sku": "",
        "price": 11880
      },
      "120885589": {
        "sku": "",
        "price": 11880
      }
    }
  },
  "2442586": {
    "name": "CAMPANA INDUSTRIAL LED SMD BRIDGELUX 200W 6500K IP44",
    "sku": "CILSMDP200F",
    "price": 79990,
    "variants": {}
  },
  "2499415": {
    "name": "PANEL LED REDONDO EMBUTIDO 18W IP44",
    "sku": "PLRE18",
    "price": 3190,
    "variants": {
      "95016390": {
        "sku": "PLRE18C",
        "price": 3190
      },
      "120885652": {
        "sku": "PLRE18N",
        "price": 3190
      },
      "120885655": {
        "sku": "PLRE18F",
        "price": 3190
      }
    }
  },
  "2499418": {
    "name": "PANEL LED REDONDO EMBUTIDO 18W IP44 REGULABLE",
    "sku": "PLRE18D",
    "price": 14500,
    "variants": {
      "4257094": {
        "sku": "PLRE18CD",
        "price": 14500
      },
      "120885659": {
        "sku": "PLRE18ND",
        "price": 14500
      },
      "120885662": {
        "sku": "PLRE18FD",
        "price": 14500
      }
    }
  },
  "2500995": {
    "name": "PANEL LED REDONDO SOBREPUESTO 18W IP44",
    "sku": "",
    "price": 3480,
    "variants": {
      "94999119": {
        "sku": "",
        "price": 3480
      },
      "120885522": {
        "sku": "",
        "price": 3480
      },
      "120885525": {
        "sku": "",
        "price": 3480
      }
    }
  },
  "2501112": {
    "name": "Panel LED 60x60 Slim 40W Dimerizable | Extra Plano eLIGHTS",
    "sku": "",
    "price": 39490,
    "variants": {
      "4258753": {
        "sku": "PL6060BDC",
        "price": 39490
      },
      "4258754": {
        "sku": "PL6060BDN",
        "price": 39490
      },
      "4258755": {
        "sku": "PL6060BDF",
        "price": 39490
      }
    }
  },
  "2502386": {
    "name": "Foco Dicroico LED Embutido SMD 9W Blanco",
    "sku": "",
    "price": 4600,
    "variants": {
      "95518891": {
        "sku": "",
        "price": 4600
      },
      "95518892": {
        "sku": "",
        "price": 4600
      }
    }
  },
  "2502408": {
    "name": "FOCO DICROICO LED EMBUTIDO SMD 12W BLANCO",
    "sku": "",
    "price": 6000,
    "variants": {
      "95519092": {
        "sku": "",
        "price": 6000
      },
      "95519093": {
        "sku": "",
        "price": 6000
      }
    }
  },
  "2502411": {
    "name": "FOCO DICROICO LED EMBUTIDO SMD 12W NIQUEL",
    "sku": "",
    "price": 6000,
    "variants": {
      "95519315": {
        "sku": "",
        "price": 6000
      },
      "95519316": {
        "sku": "",
        "price": 6000
      }
    }
  },
  "2502678": {
    "name": "APLIQUE LED SOLAR 5W LUZ FRÍA 500 LM IP65",
    "sku": "ALS5F",
    "price": 6190,
    "variants": {}
  },
  "2502680": {
    "name": "APLIQUE LED SOLAR 10W LUZ FRÍA 500 LM IP65",
    "sku": "ALS10F",
    "price": 14190,
    "variants": {}
  },
  "2506428": {
    "name": "ESTANCA LED 40W 120 CM. IP65",
    "sku": "",
    "price": 16390,
    "variants": {
      "8861735": {
        "sku": "EL40120C",
        "price": 16390
      },
      "8861736": {
        "sku": "EL40120N",
        "price": 16390
      },
      "8861737": {
        "sku": "EL40120F",
        "price": 16390
      }
    }
  },
  "2506690": {
    "name": "CANOA LED HERMÉTICA 2X18W IP65 IK07 1200 MM. PMMA",
    "sku": "CLH2X18",
    "price": 10140,
    "variants": {}
  },
  "2506736": {
    "name": "CANOA LED HERMÉTICA 1X18W IP65 IK07 1200 MM. PMMA",
    "sku": "CLH1X18",
    "price": 7990,
    "variants": {}
  },
  "2506808": {
    "name": "CANOA LED HERMÉTICA 1X9W IP65 IK07 60 CM. PMMA",
    "sku": "",
    "price": 6500,
    "variants": {}
  },
  "2506825": {
    "name": "CANOA LED HERMÉTICA 2X9W IP65 IK07 600 MM. PMMA",
    "sku": "CLH2X9",
    "price": 8990,
    "variants": {}
  },
  "2767982": {
    "name": "LUMINARIA ORNAMENTAL ISLAND 60W IP66 IK08",
    "sku": "",
    "price": 167900,
    "variants": {
      "95634737": {
        "sku": "",
        "price": 167900
      },
      "95634738": {
        "sku": "",
        "price": 167900
      },
      "95634739": {
        "sku": "",
        "price": 167900
      },
      "106025732": {
        "sku": "",
        "price": 167900
      }
    }
  },
  "2993067": {
    "name": "PROYECTOR LED SLIM SMD 500W IP66",
    "sku": "",
    "price": 213600,
    "variants": {
      "7201884": {
        "sku": "PLSSMD500C",
        "price": 213600
      },
      "7201885": {
        "sku": "PLSSMD500F",
        "price": 213600
      },
      "121250285": {
        "sku": "",
        "price": 213600
      },
      "121250286": {
        "sku": "",
        "price": 213600
      }
    }
  },
  "3099262": {
    "name": "WALL WASHER 36W IP65",
    "sku": "",
    "price": 48990,
    "variants": {
      "4772989": {
        "sku": "WW36C",
        "price": 48990
      },
      "4772991": {
        "sku": "WW36F",
        "price": 48990
      }
    }
  },
  "3123738": {
    "name": "PROYECTOR LED ULTRA THIN SMD 10W IP66 LUZ FRÍA C/ SENSOR DE MOVIMIENTO",
    "sku": "",
    "price": 7485,
    "variants": {
      "7094744": {
        "sku": "PLRS18SF",
        "price": 7485
      }
    }
  },
  "3123789": {
    "name": "PROYECTOR LED ULTRA THIN SMD 30W IP66 LUZ FRÍA C/ SENSOR DE MOVIMIENTO",
    "sku": "PLUTSMD30SMF",
    "price": 11570,
    "variants": {}
  },
  "3124480": {
    "name": "PROYECTOR LED ULTRA THIN SMD 20W IP66 LUZ FRÍA C/ SENSOR DE MOVIMIENTO",
    "sku": "PLUTSMD20SMF",
    "price": 9000,
    "variants": {}
  },
  "3192973": {
    "name": "SEÑALETICA DE EMERGENCIA LED SALIDA 3W 4 HRS AUTONOMÍA",
    "sku": "SEL3S",
    "price": 16900,
    "variants": {}
  },
  "3213127": {
    "name": "LINEAL LED EMBUTIDA 40W 120 CM.",
    "sku": "LLE40120N",
    "price": 33670,
    "variants": {
      "99319918": {
        "sku": "LLE40120N",
        "price": 33670
      },
      "99319919": {
        "sku": "LLE40120N",
        "price": 33670
      },
      "99319920": {
        "sku": "LLE40120N",
        "price": 33670
      }
    }
  },
  "3229761": {
    "name": "PANEL LED CONCENTRICO OPAL 25W IP33",
    "sku": "",
    "price": 12900,
    "variants": {
      "94905403": {
        "sku": "",
        "price": 12900
      },
      "94905404": {
        "sku": "",
        "price": 12900
      },
      "94905405": {
        "sku": "",
        "price": 12900
      }
    }
  },
  "3283555": {
    "name": "PROYECTOR LED DE ESTADIO 500W IP66 IK09",
    "sku": "",
    "price": 333600,
    "variants": {
      "95929944": {
        "sku": "",
        "price": 333600
      },
      "95929945": {
        "sku": "",
        "price": 333600
      }
    }
  },
  "3305420": {
    "name": "AMPOLLETA LED AR111 12-120W OPAL CONCÉNTRICA",
    "sku": "",
    "price": 16200,
    "variants": {
      "5890527": {
        "sku": "ALAR11112OCC",
        "price": 16200
      },
      "5890528": {
        "sku": "ALAR11112OCN",
        "price": 16200
      },
      "5890529": {
        "sku": "ALAR11112OCF",
        "price": 16200
      }
    }
  },
  "3309140": {
    "name": "PROYECTOR LED DE ESTADIO REDONDO 1000W IP66 IK09",
    "sku": "",
    "price": 765600,
    "variants": {
      "115225152": {
        "sku": "",
        "price": 765600
      },
      "115225153": {
        "sku": "",
        "price": 765600
      },
      "115225154": {
        "sku": "",
        "price": 765600
      },
      "115225155": {
        "sku": "",
        "price": 765600
      }
    }
  },
  "3313196": {
    "name": "PROYECTOR LED DE ESTADIO 300W IP66 IK09",
    "sku": "",
    "price": 309600,
    "variants": {
      "95929929": {
        "sku": "PLE300F",
        "price": 309600
      },
      "100177907": {
        "sku": "",
        "price": 309600
      }
    }
  },
  "3381394": {
    "name": "KIT DE EMERGENCIA LED 20W 90 MINUTOS AUTONOMIA",
    "sku": "SS20W",
    "price": 18500,
    "variants": {}
  },
  "3387274": {
    "name": "CAMPANA LED UFO A PRUEBA DE EXPLOSIÓN 100W",
    "sku": "PLAPE100F",
    "price": 201600,
    "variants": {}
  },
  "3387318": {
    "name": "CAMPANA LED UFO A PRUEBA DE EXPLOSIÓN 150W",
    "sku": "PLAPE150F",
    "price": 251900,
    "variants": {}
  },
  "3398236": {
    "name": "FAROL ORNAMENTAL FREYA 10W IP65 60CM.",
    "sku": "",
    "price": 31500,
    "variants": {
      "5957536": {
        "sku": "FOF10C",
        "price": 31500
      },
      "5957537": {
        "sku": "FOF10F",
        "price": 31500
      }
    }
  },
  "3409235": {
    "name": "APLIQUE DECORATIVO OVALADO MURO 10W IP65 NEGRO",
    "sku": "ADOEXM10N",
    "price": 25160,
    "variants": {
      "5961472": {
        "sku": "ADOEXM10NC",
        "price": 25160
      },
      "5961473": {
        "sku": "ADOEXM10NF",
        "price": 25160
      }
    }
  },
  "3433454": {
    "name": "EQUIPO LED DE EMERGENCIA 2*1.2W",
    "sku": "",
    "price": 12900,
    "variants": {}
  },
  "3481496": {
    "name": "PANEL LED RETRAÍDO OPAL 40W IP40",
    "sku": "",
    "price": 21900,
    "variants": {
      "6032731": {
        "sku": "DLRO40N",
        "price": 21900
      }
    }
  },
  "3612990": {
    "name": "DOWNLIGHT LED SOBREPUESTO 7W LAVADORA SLIM IP20",
    "sku": "DLS7LVB",
    "price": 7650,
    "variants": {
      "11927495": {
        "sku": "",
        "price": 7650
      },
      "11927496": {
        "sku": "",
        "price": 7650
      }
    }
  },
  "3613081": {
    "name": "KIT DE EMERGENCIA LED SS36W 90 MINUTOS DE AUTONOMIA",
    "sku": "SS36W",
    "price": 17400,
    "variants": {}
  },
  "3614974": {
    "name": "RIEL TRIFÁSICO 1 MT.",
    "sku": "RT1MT",
    "price": 16660,
    "variants": {}
  },
  "3615048": {
    "name": "RIEL TRIFÁSICO 2 MT.",
    "sku": "RT2MT",
    "price": 25500,
    "variants": {}
  },
  "3702364": {
    "name": "PANEL LED BACKLIGHT 120X60 CM. 96W PARA CIELO AMERICANO",
    "sku": "",
    "price": 31100,
    "variants": {
      "6202217": {
        "sku": "PLB120100BF",
        "price": 31100
      },
      "8717397": {
        "sku": "PLB120100BN",
        "price": 31100
      }
    }
  },
  "3724234": {
    "name": "AMPOLLETA LED DICROICA 6W GU10 OPAL",
    "sku": "",
    "price": 1990,
    "variants": {
      "6232152": {
        "sku": "ALE6GC",
        "price": 1990
      },
      "6232162": {
        "sku": "ALE6GF",
        "price": 1990
      }
    }
  },
  "3770404": {
    "name": "TRIPODE PARA PROYECTOR LED 10W / 20W/ 30W/ 50W/ 100W/ 150W/ 200W",
    "sku": "TEPPL",
    "price": 18000,
    "variants": {}
  },
  "3921249": {
    "name": "LINEAL LED FLAT 54W 120 CM. IP44",
    "sku": "",
    "price": 10520,
    "variants": {
      "6544256": {
        "sku": "LLF54120C",
        "price": 10520
      },
      "6544257": {
        "sku": "LLF54120N",
        "price": 10520
      },
      "6544258": {
        "sku": "LLF54120F",
        "price": 10520
      }
    }
  },
  "3952758": {
    "name": "CINTA LED EXTERIOR 14.4W 5730 72 LEDs/Mt. 10MM IP67 100MT 220V",
    "sku": "",
    "price": 159900,
    "variants": {
      "6577110": {
        "sku": "CLE155772C",
        "price": 159900
      },
      "6577111": {
        "sku": "CLE155772F",
        "price": 159900
      },
      "108161308": {
        "sku": "",
        "price": 159900
      }
    }
  },
  "3954845": {
    "name": "CINTA LED LED EXTERIOR VERDE 14,4W/m 72 LEDs/m IP67 100 mt. 220V",
    "sku": "MLE165220V",
    "price": 140400,
    "variants": {}
  },
  "3972346": {
    "name": "APLIQUE LED MURO 5W IP65 GRIS",
    "sku": "AMEL3G",
    "price": 7540,
    "variants": {
      "6593334": {
        "sku": "ALM5IP65GF",
        "price": 7540
      },
      "6593335": {
        "sku": "ALM5IP65GF",
        "price": 7540
      }
    }
  },
  "4122694": {
    "name": "CAMPANA LED UFO NF3 100W 150LM/W IP66",
    "sku": "",
    "price": 33600,
    "variants": {
      "6791302": {
        "sku": "CUFONF3100F",
        "price": 33600
      },
      "88152836": {
        "sku": "CUFONF3100N",
        "price": 33600
      }
    }
  },
  "4122715": {
    "name": "CAMPANA LED UFO NF3 150W 150 LM/W  IP66",
    "sku": "",
    "price": 51600,
    "variants": {
      "95435182": {
        "sku": "",
        "price": 51600
      },
      "95435183": {
        "sku": "",
        "price": 51600
      }
    }
  },
  "4122737": {
    "name": "CAMPANA LED UFO NF3 200W 150LM/W IP66",
    "sku": "",
    "price": 69600,
    "variants": {
      "6791440": {
        "sku": "CUFONF3200F",
        "price": 69600
      },
      "87997928": {
        "sku": "CUFONF3200N",
        "price": 69600
      },
      "88800398": {
        "sku": "CUFONF3200C",
        "price": 69600
      }
    }
  },
  "4123096": {
    "name": "FOCO LED A RIEL MONOFÁSICO NEGRO 40W",
    "sku": "",
    "price": 16250,
    "variants": {
      "8806989": {
        "sku": "FLRM40NC",
        "price": 16250
      },
      "8806990": {
        "sku": "FLRM40NN",
        "price": 16250
      }
    }
  },
  "4129683": {
    "name": "FOCO LED EMBUTIDO EN PISO 18W IP67",
    "sku": "",
    "price": 26500,
    "variants": {
      "6800407": {
        "sku": "FLEP18C",
        "price": 26500
      },
      "6800408": {
        "sku": "FLEP18F",
        "price": 26500
      }
    }
  },
  "4133126": {
    "name": "120x30 MARCO PARA SOBREPONER PANEL LED CIELO AMERICANO",
    "sku": "MSPL120X30",
    "price": 10900,
    "variants": {}
  },
  "4133148": {
    "name": "60x60 MARCO PARA SOBREPONER PANEL LED CIELO AMERICANO",
    "sku": "MSPL60X60",
    "price": 9390,
    "variants": {}
  },
  "4133194": {
    "name": "120x60 MARCO PARA SOBREPONER PANEL LED CIELO AMERICANO",
    "sku": "MSPL120X60",
    "price": 11800,
    "variants": {}
  },
  "4156930": {
    "name": "ALUMBRADO PÚBLICO BESTLED 150W IP66 IK08",
    "sku": "",
    "price": 172000,
    "variants": {
      "8853442": {
        "sku": "APB150N",
        "price": 172000
      },
      "113961236": {
        "sku": "APB1507",
        "price": 189200
      },
      "113961237": {
        "sku": "APB150F",
        "price": 172000
      },
      "116896286": {
        "sku": "APB1501",
        "price": 189200
      }
    }
  },
  "4190659": {
    "name": "PANEL LED BACKLIGHT 60X60 CM. 48W PARA CIELO AMERICANO",
    "sku": "",
    "price": 12990,
    "variants": {
      "103713736": {
        "sku": "",
        "price": 12990
      },
      "103713737": {
        "sku": "",
        "price": 12990
      },
      "103713738": {
        "sku": "",
        "price": 12990
      }
    }
  },
  "4361806": {
    "name": "Foco Dicroico LED Embutido SMD 18W Niquel",
    "sku": "",
    "price": 16200,
    "variants": {
      "95520898": {
        "sku": "",
        "price": 16200
      },
      "95520899": {
        "sku": "",
        "price": 16200
      }
    }
  },
  "4370201": {
    "name": "FUENTE DE PODER SWITCHING 400W 12V 33A  INTERIOR PERFORADA",
    "sku": "FU400I",
    "price": 37400,
    "variants": {}
  },
  "4371411": {
    "name": "PANEL LED CONCENTRICO OPAL 40W IP33",
    "sku": "",
    "price": 22900,
    "variants": {
      "7500839": {
        "sku": "DLRCO40N",
        "price": 22900
      }
    }
  },
  "4426526": {
    "name": "PANEL LED BACKLIGHT 120X30 CM. 48W PARA CIELO AMERICANO",
    "sku": "",
    "price": 15900,
    "variants": {
      "8713180": {
        "sku": "PLB12040BC",
        "price": 15900
      },
      "8741597": {
        "sku": "PLB12040BN",
        "price": 15900
      },
      "87995436": {
        "sku": "PLB12040BF",
        "price": 15900
      }
    }
  },
  "4450187": {
    "name": "PROYECTOR LED DE ESTADIO 600W IP66 IK09",
    "sku": "",
    "price": 466800,
    "variants": {
      "95929972": {
        "sku": "PLE600F",
        "price": 466800
      }
    }
  },
  "4537309": {
    "name": "FUENTE DE PODER SWITCHING 150W 12V 12.5A EXTERIOR IP67",
    "sku": "FU150E",
    "price": 23400,
    "variants": {}
  },
  "4608256": {
    "name": "PANEL LED SLIM 60X60 CM. 40W PARA CIELO AMERICANO",
    "sku": "",
    "price": 19800,
    "variants": {
      "8853489": {
        "sku": "PL6040BC",
        "price": 19800
      },
      "8853490": {
        "sku": "PL6040BN",
        "price": 19800
      },
      "8853491": {
        "sku": "PL6040BF",
        "price": 19800
      }
    }
  },
  "4615634": {
    "name": "ESTACA LED SOLAR 4W JARDÍN IP65",
    "sku": "",
    "price": 10990,
    "variants": {
      "95315655": {
        "sku": "ELC5J",
        "price": 10990
      },
      "118625443": {
        "sku": "",
        "price": 10990
      }
    }
  },
  "4622926": {
    "name": "APLIQUE MURO EXTERIOR LED 5W IP65 NEGRO",
    "sku": "",
    "price": 13900,
    "variants": {
      "8862318": {
        "sku": "AMEL5C",
        "price": 13900
      },
      "8862319": {
        "sku": "AMEL5F",
        "price": 13900
      }
    }
  },
  "4730253": {
    "name": "120x15 MARCO PARA SOBREPONER PANEL LED CIELO AMERICANO",
    "sku": "MSPL120X15",
    "price": 9500,
    "variants": {}
  },
  "10796623": {
    "name": "LUMINARIA ORNAMENTAL ISLAND 90W IP66 IK08",
    "sku": "",
    "price": 203900,
    "variants": {
      "95634500": {
        "sku": "",
        "price": 203900
      },
      "95634501": {
        "sku": "",
        "price": 203900
      },
      "106025739": {
        "sku": "",
        "price": 203900
      },
      "106025740": {
        "sku": "",
        "price": 203900
      }
    }
  },
  "11521285": {
    "name": "ALUMBRADO PÚBLICO LED SOLAR FLYHAWK 40-80W",
    "sku": "APSB80N",
    "price": 442800,
    "variants": {
      "118197691": {
        "sku": "APSB80N",
        "price": 442800
      },
      "118197717": {
        "sku": "",
        "price": 442800
      },
      "118197718": {
        "sku": "",
        "price": 442800
      },
      "118197860": {
        "sku": "APSB80N",
        "price": 478800
      },
      "118197861": {
        "sku": "",
        "price": 478800
      },
      "118197862": {
        "sku": "",
        "price": 478800
      },
      "118197863": {
        "sku": "APSB80N",
        "price": 514800
      },
      "118197864": {
        "sku": "",
        "price": 514800
      },
      "118197865": {
        "sku": "",
        "price": 514800
      }
    }
  },
  "13193689": {
    "name": "PROYECTOR LED PORTÁTIL A PRUEBA DE EXPLOSIÓN 30W",
    "sku": "PLP30APEX",
    "price": 359990,
    "variants": {}
  },
  "14582065": {
    "name": "ALUMBRADO PÚBLICO LED SOLAR 300W CON PANEL SOLAR  CON BRAZO PARA MONTAR EN MURO O POSTE",
    "sku": "APS300PB",
    "price": 159900,
    "variants": {
      "117807100": {
        "sku": "APS300PB",
        "price": 159900
      },
      "117807101": {
        "sku": "APS300PB",
        "price": 159900
      },
      "117807102": {
        "sku": "APS300PB",
        "price": 159900
      },
      "117807103": {
        "sku": "APS300PB",
        "price": 159900
      }
    }
  },
  "15014164": {
    "name": "LÁMPARA DE EMERGENCIA LED ANTIEXPLOSIVA 2X3W IP65 IK10",
    "sku": "LEATEX2X8",
    "price": 117900,
    "variants": {}
  },
  "15021313": {
    "name": "ALUMBRADO PÚBLICO BESTLED 250W IP66 IK08",
    "sku": "",
    "price": 269900,
    "variants": {
      "95224603": {
        "sku": "APB250N",
        "price": 269900
      },
      "95224604": {
        "sku": "APB250F",
        "price": 269900
      },
      "118465898": {
        "sku": "APB2501",
        "price": 296900
      },
      "118465899": {
        "sku": "APB2507",
        "price": 296900
      }
    }
  },
  "15145687": {
    "name": "ESTACA LED COB 5W JARDÍN IP65",
    "sku": "",
    "price": 7500,
    "variants": {
      "95315720": {
        "sku": "",
        "price": 7500
      },
      "114137566": {
        "sku": "",
        "price": 7500
      }
    }
  },
  "15164777": {
    "name": "CAMPANA LED UFO A PRUEBA DE EXPLOSIÓN 200W",
    "sku": "PLAPEX200F",
    "price": 321600,
    "variants": {}
  },
  "15714107": {
    "name": "APLIQUE LED 20W DE PARED MODERNA IP65 3000K",
    "sku": "",
    "price": 18900,
    "variants": {}
  },
  "15808487": {
    "name": "LINEAL LED SUSPENDIDA SUPERMARKET 40W 120 CM. BLANCA",
    "sku": "",
    "price": 29900,
    "variants": {
      "87857357": {
        "sku": "",
        "price": 29900
      },
      "87857358": {
        "sku": "",
        "price": 29900
      },
      "87857359": {
        "sku": "",
        "price": 29900
      }
    }
  },
  "15818366": {
    "name": "LINEAL LED SUSPENDIDA SUPERMARKET 40W 120 CM. GRIS",
    "sku": "",
    "price": 29900,
    "variants": {
      "87858310": {
        "sku": "",
        "price": 29900
      },
      "87858311": {
        "sku": "",
        "price": 29900
      },
      "87858312": {
        "sku": "",
        "price": 29900
      }
    }
  },
  "15819821": {
    "name": "LINEAL LED SUSPENDIDA SUPERMARKET 40W 120 CM. NEGRA",
    "sku": "",
    "price": 29900,
    "variants": {
      "87858372": {
        "sku": "",
        "price": 29900
      },
      "87858373": {
        "sku": "",
        "price": 29900
      },
      "87858374": {
        "sku": "",
        "price": 29900
      }
    }
  },
  "15913820": {
    "name": "BARRA DE EMERGENCIA 60 LEDs RECARGABLE AUTONOMÍA 3-6 HRS.",
    "sku": "BELR60SMD",
    "price": 25870,
    "variants": {}
  },
  "16068709": {
    "name": "CAMPANA LED UFO NF6 150W 110LM/W IP65",
    "sku": "",
    "price": 33600,
    "variants": {
      "88022731": {
        "sku": "CLUFONF6150F",
        "price": 33600
      },
      "88022844": {
        "sku": "CLUFONF6150N",
        "price": 33600
      }
    }
  },
  "16068999": {
    "name": "CAMPANA LED UFO NF6 200W 110LM/W IP65",
    "sku": "",
    "price": 45600,
    "variants": {
      "100156772": {
        "sku": "",
        "price": 45600
      },
      "100156925": {
        "sku": "",
        "price": 45600
      }
    }
  },
  "16096437": {
    "name": "FOCO LED A RIEL MONOFÁSICO BLANCO 40W",
    "sku": "",
    "price": 16250,
    "variants": {
      "88106085": {
        "sku": "FLRM40BC",
        "price": 16250
      },
      "88106086": {
        "sku": "FLRM40BN",
        "price": 16250
      }
    }
  },
  "16096653": {
    "name": "FOCO LED A RIEL TRIFÁSICO 40W BLANCO",
    "sku": "",
    "price": 33660,
    "variants": {
      "88107511": {
        "sku": "FLRT40BC",
        "price": 33660
      },
      "88107512": {
        "sku": "FLRT40BN",
        "price": 33660
      },
      "88107513": {
        "sku": "FLRT40BF",
        "price": 33660
      }
    }
  },
  "16097375": {
    "name": "CAMPANA LED UFO A PRUEBA DE EXPLOSIÓN 50W",
    "sku": "PLAPEX50F",
    "price": 189900,
    "variants": {}
  },
  "16114117": {
    "name": "CAMPANA LED UFO NF6 100W 110LM/W IP65",
    "sku": "",
    "price": 25900,
    "variants": {
      "88157685": {
        "sku": "CLUFONF6100F",
        "price": 25900
      },
      "88157686": {
        "sku": "CLUFONF6100N",
        "price": 25900
      }
    }
  },
  "16121675": {
    "name": "APLIQUE LED 30W DE PARED MODERNA IP65",
    "sku": "",
    "price": 18900,
    "variants": {
      "111714339": {
        "sku": "",
        "price": 18900
      },
      "111714340": {
        "sku": "",
        "price": 18900
      }
    }
  },
  "16160509": {
    "name": "TORTUGA ALUMINIO OVAL C/ REJILLA E27 IP54 NEGRA",
    "sku": "TAOCRE27",
    "price": 3990,
    "variants": {}
  },
  "16166612": {
    "name": "PROYECTOR LED RGB 30W IP66 NEGRO",
    "sku": "PLCRGB30N",
    "price": 20160,
    "variants": {}
  },
  "16166778": {
    "name": "PROYECTOR LED RGB 50W IP66 NEGRO",
    "sku": "PLCRGB50N",
    "price": 30000,
    "variants": {}
  },
  "16273624": {
    "name": "APLIQUE MURO VERTICAL LED 5W IP65 NEGRO",
    "sku": "",
    "price": 13900,
    "variants": {
      "88390859": {
        "sku": "AMVL5C",
        "price": 13900
      },
      "88390860": {
        "sku": "AMVL5F",
        "price": 13900
      }
    }
  },
  "16423843": {
    "name": "KIT DE EMERGENCIA LED SS30W 90 MINUTOS DE AUTONOMIA",
    "sku": "SS30W",
    "price": 11760,
    "variants": {}
  },
  "16652746": {
    "name": "FOCO LED EMBUTIDO EN PISO GU10 IP67",
    "sku": "FLEPGU10",
    "price": 10990,
    "variants": {}
  },
  "16713032": {
    "name": "APLIQUE MURO BIDIRECCIONAL 16W IP54 NEGRO",
    "sku": "AMB16W",
    "price": 15990,
    "variants": {
      "118410531": {
        "sku": "AMB16W",
        "price": 15990
      },
      "118410532": {
        "sku": "AMB16W",
        "price": 15990
      }
    }
  },
  "16728389": {
    "name": "FOCO LED A RIEL TRIFÁSICO 40W NEGRO",
    "sku": "",
    "price": 33660,
    "variants": {
      "88743924": {
        "sku": "FLRT40NC",
        "price": 33660
      },
      "88743925": {
        "sku": "FLRT40NN",
        "price": 33660
      },
      "88743926": {
        "sku": "FLRT40NF",
        "price": 33660
      }
    }
  },
  "16755056": {
    "name": "CAMPANA LED UFO NF3 250W 150LM/W IP66",
    "sku": "",
    "price": 117600,
    "variants": {
      "88800759": {
        "sku": "CUFONF3250F",
        "price": 117600
      }
    }
  },
  "16755401": {
    "name": "CAMPANA LED UFO NF3 300W 150LM/W IP66",
    "sku": "",
    "price": 117900,
    "variants": {
      "88801056": {
        "sku": "CUFONF3300C",
        "price": 117900
      },
      "88801057": {
        "sku": "CUFONF3300N",
        "price": 117900
      },
      "95471323": {
        "sku": "",
        "price": 117900
      }
    }
  },
  "16842942": {
    "name": "CANOA DOBLE PARA TUBO LED 1200 MM.",
    "sku": "",
    "price": 2690,
    "variants": {}
  },
  "16848748": {
    "name": "TUBO LED T8 OPAL VIDRIO 24W 150CM 220V",
    "sku": "",
    "price": 4560,
    "variants": {
      "98855111": {
        "sku": "",
        "price": 4560
      },
      "98855112": {
        "sku": "",
        "price": 4560
      },
      "98855113": {
        "sku": "",
        "price": 4560
      }
    }
  },
  "19136920": {
    "name": "ALUMBRADO PÚBLICO LED SOLAR 90W ALL IN ONE",
    "sku": "APSALL90",
    "price": 101400,
    "variants": {}
  },
  "19841604": {
    "name": "SEÑALÉTICA DE EMERGENCIA SALIDA A PRUEBA DE EXPLOSIÓN",
    "sku": "SDESAPEX",
    "price": 127400,
    "variants": {}
  },
  "20450795": {
    "name": "PROYECTOR LED DE EMERGENCIA RECARGABLE SMD 100W IP66",
    "sku": "PLER100F",
    "price": 81600,
    "variants": {}
  },
  "20610994": {
    "name": "CAMPANA LED UFO NF6 300W 110LM/W IP65",
    "sku": "",
    "price": 81600,
    "variants": {
      "94196491": {
        "sku": "CLUFONF6300N",
        "price": 81600
      },
      "100156806": {
        "sku": "CLUFONF6300F",
        "price": 81600
      }
    }
  },
  "20743792": {
    "name": "PROYECTOR LED ULTRA SLIM 10W IP66 NEGRO",
    "sku": "",
    "price": 1890,
    "variants": {
      "94913516": {
        "sku": "",
        "price": 1890
      },
      "118661522": {
        "sku": "",
        "price": 1890
      }
    }
  },
  "20751964": {
    "name": "PROYECTOR LED ULTRA SLIM 20W IP66 NEGRO",
    "sku": "",
    "price": 2790,
    "variants": {
      "94913512": {
        "sku": "",
        "price": 2790
      },
      "118661543": {
        "sku": "",
        "price": 2790
      }
    }
  },
  "20752601": {
    "name": "PROYECTOR LED ULTRA SLIM 30W IP66 NEGRO",
    "sku": "",
    "price": 3290,
    "variants": {
      "118661557": {
        "sku": "",
        "price": 3290
      },
      "118661558": {
        "sku": "",
        "price": 3290
      }
    }
  },
  "20754001": {
    "name": "PROYECTOR LED ULTRA SLIM 50W IP66 NEGRO",
    "sku": "",
    "price": 4190,
    "variants": {
      "118662213": {
        "sku": "",
        "price": 4190
      },
      "118662214": {
        "sku": "",
        "price": 4190
      }
    }
  },
  "20754238": {
    "name": "PROYECTOR LED ULTRA SLIM 100W IP66 NEGRO",
    "sku": "",
    "price": 9390,
    "variants": {
      "118663219": {
        "sku": "",
        "price": 9390
      },
      "118663220": {
        "sku": "",
        "price": 9390
      }
    }
  },
  "20754402": {
    "name": "PROYECTOR LED ULTRA SLIM 150W IP66 NEGRO",
    "sku": "",
    "price": 13920,
    "variants": {
      "94905551": {
        "sku": "",
        "price": 13920
      },
      "94905552": {
        "sku": "",
        "price": 13920
      }
    }
  },
  "20754533": {
    "name": "PROYECTOR LED ULTRA SLIM 200W IP66 NEGRO",
    "sku": "",
    "price": 18480,
    "variants": {
      "94913533": {
        "sku": "",
        "price": 18480
      },
      "94913534": {
        "sku": "",
        "price": 18480
      }
    }
  },
  "20754789": {
    "name": "PROYECTOR LED ULTRA SLIM 300W IP66 NEGRO",
    "sku": "",
    "price": 58200,
    "variants": {
      "94913521": {
        "sku": "",
        "price": 58200
      },
      "94913522": {
        "sku": "",
        "price": 58200
      }
    }
  },
  "20782912": {
    "name": "PROYECTOR LED ULTRA SLIM 400W IP66 NEGRO",
    "sku": "",
    "price": 118800,
    "variants": {
      "94913483": {
        "sku": "",
        "price": 118800
      },
      "94913484": {
        "sku": "",
        "price": 118800
      }
    }
  },
  "20783449": {
    "name": "PROYECTOR LED ULTRA SLIM 500W IP66 NEGRO",
    "sku": "",
    "price": 148800,
    "variants": {
      "94905568": {
        "sku": "",
        "price": 148800
      },
      "94905569": {
        "sku": "",
        "price": 148800
      }
    }
  },
  "20845068": {
    "name": "KIT DE EMERGENCIA LED 3-48W 120 MINUTOS DE AUTONOMIA",
    "sku": "SS48W",
    "price": 13080,
    "variants": {}
  },
  "21064489": {
    "name": "PANEL LED CONCENTRICO OPAL 5W IP20",
    "sku": "",
    "price": 5900,
    "variants": {
      "94905413": {
        "sku": "",
        "price": 5900
      },
      "94905414": {
        "sku": "",
        "price": 5900
      }
    }
  },
  "21237598": {
    "name": "TUBO LED T5 OPAL VIDRIO 9W 220V",
    "sku": "",
    "price": 2800,
    "variants": {
      "95177030": {
        "sku": "",
        "price": 2800
      },
      "95177031": {
        "sku": "",
        "price": 2800
      },
      "95177032": {
        "sku": "",
        "price": 2800
      }
    }
  },
  "21238265": {
    "name": "TUBO LED T5 OPAL VIDRIO 18W 220V",
    "sku": "",
    "price": 3000,
    "variants": {
      "95177036": {
        "sku": "",
        "price": 3000
      },
      "95177037": {
        "sku": "",
        "price": 3000
      },
      "95177038": {
        "sku": "",
        "price": 3000
      }
    }
  },
  "21239444": {
    "name": "FOCO LED EMBUTIDO EN PISO 36W IP67",
    "sku": "",
    "price": 81600,
    "variants": {
      "95178953": {
        "sku": "",
        "price": 81600
      },
      "95178954": {
        "sku": "",
        "price": 81600
      }
    }
  },
  "21244485": {
    "name": "POSTE TUBULAR GALVANIZADO 4MTS",
    "sku": "PTG4M",
    "price": 115900,
    "variants": {}
  },
  "21244500": {
    "name": "POSTE TUBULAR GALVANIZADO 5MTS",
    "sku": "PTG5M",
    "price": 130900,
    "variants": {}
  },
  "21244533": {
    "name": "POSTE TUBULAR GALVANIZADO 6MTS",
    "sku": "PTG6M",
    "price": 135900,
    "variants": {}
  },
  "21391522": {
    "name": "FOCO DICROICO LED EMBUTIDO SMD 15W NIQUEL",
    "sku": "",
    "price": 13000,
    "variants": {
      "95519334": {
        "sku": "",
        "price": 13000
      },
      "95519335": {
        "sku": "",
        "price": 13000
      }
    }
  },
  "21392612": {
    "name": "Foco Dicroico LED Embutido SMD 24W Niquel",
    "sku": "",
    "price": 24000,
    "variants": {
      "95520928": {
        "sku": "",
        "price": 24000
      },
      "95520929": {
        "sku": "",
        "price": 24000
      }
    }
  },
  "21392713": {
    "name": "Foco Dicroico LED Embutido SMD 30W Niquel",
    "sku": "",
    "price": 26200,
    "variants": {
      "95521230": {
        "sku": "",
        "price": 26200
      },
      "95521231": {
        "sku": "",
        "price": 26200
      }
    }
  },
  "21441880": {
    "name": "PANEL LED BACKLIGHT 60X30 CM. 40W PARA CIELO AMERICANO",
    "sku": "",
    "price": 14200,
    "variants": {
      "95662543": {
        "sku": "",
        "price": 14200
      },
      "95662544": {
        "sku": "",
        "price": 14200
      }
    }
  },
  "21519463": {
    "name": "LÁMPARA DE EMERGENCIA LED 2X4W IP67",
    "sku": "LEATEX2X4",
    "price": 35900,
    "variants": {}
  },
  "21739206": {
    "name": "AMPOLLETA LED BOLA 15W E27",
    "sku": "",
    "price": 1690,
    "variants": {
      "96221780": {
        "sku": "",
        "price": 1690
      },
      "96221781": {
        "sku": "",
        "price": 1690
      }
    }
  },
  "21743223": {
    "name": "KIT DE EMERGENCIA LED 50W UNIVERSAL 90 MINUTOS DE AUTONOMIA",
    "sku": "SS50W",
    "price": 16900,
    "variants": {}
  },
  "21766686": {
    "name": "PANEL LED 120X15 CM 36W. LUZ CÁLIDA PARA CIELO AMERICANO",
    "sku": "",
    "price": 17100,
    "variants": {
      "96276928": {
        "sku": "",
        "price": 17100
      },
      "96276929": {
        "sku": "",
        "price": 17100
      }
    }
  },
  "21809432": {
    "name": "CINTA LED EXTERIOR 6,5W SMD 2835 48LEDs/m 100mt. 220V. RGB",
    "sku": "CLE283548220VRGB",
    "price": 191890,
    "variants": {}
  },
  "22672906": {
    "name": "CINTA LED EXTERIOR 14,4W SMD 5730 72LEDs/m 100mt. 220V. AMARILLO",
    "sku": "CLE573072220VAM",
    "price": 139900,
    "variants": {}
  },
  "22679546": {
    "name": "CINTA LED EXTERIOR 14,4W SMD 5730 72LEDs/m 100mt. 220V. AZUL",
    "sku": "CLE573072220VA",
    "price": 139900,
    "variants": {}
  },
  "22679578": {
    "name": "CINTA LED EXTERIOR 14,4W SMD 5730 72LEDs/m 100mt. 220V. ROJO",
    "sku": "CLE573072220VR",
    "price": 139900,
    "variants": {}
  },
  "23188967": {
    "name": "PROYECTOR LED ULTRA SLIM 1000W IP66 NEGRO",
    "sku": "",
    "price": 378000,
    "variants": {
      "98856612": {
        "sku": "",
        "price": 378000
      },
      "98856613": {
        "sku": "",
        "price": 378000
      }
    }
  },
  "23188968": {
    "name": "PROYECTOR LED ULTRA SLIM 600W IP66 NEGRO",
    "sku": "",
    "price": 177900,
    "variants": {
      "98856617": {
        "sku": "",
        "price": 177900
      },
      "98856618": {
        "sku": "",
        "price": 177900
      }
    }
  },
  "24031164": {
    "name": "CAMPANA LED UFO NF8 100W 110LM/W IP65",
    "sku": "",
    "price": 22000,
    "variants": {
      "100157168": {
        "sku": "CLUFONF8100F",
        "price": 22000
      },
      "100157169": {
        "sku": "CLUFONF8100N",
        "price": 22000
      }
    }
  },
  "24040212": {
    "name": "CAMPANA LED UFO NF8 150W 110LM/W IP65",
    "sku": "",
    "price": 26500,
    "variants": {
      "100179792": {
        "sku": "CUFONF8150C",
        "price": 26500
      },
      "100179793": {
        "sku": "CUFONF8150F",
        "price": 26500
      }
    }
  },
  "24040292": {
    "name": "CAMPANA LED UFO NF8 200W 110LM/W IP65",
    "sku": "",
    "price": 33600,
    "variants": {
      "100179951": {
        "sku": "CUFONF8200C",
        "price": 33600
      },
      "100179952": {
        "sku": "CUFONF8200F",
        "price": 33600
      }
    }
  },
  "24043822": {
    "name": "CAMPANA LED UFO NF8 PRO 300W 150LM/W IP65",
    "sku": "",
    "price": 97200,
    "variants": {
      "100182787": {
        "sku": "CUFONF8P300F",
        "price": 97200
      }
    }
  },
  "24192756": {
    "name": "PROYECTOR LED ULTRA SLIM 50W IP66 NEGRO C/ SENSOR DE MOVIMIENTO",
    "sku": "",
    "price": 15490,
    "variants": {
      "100489355": {
        "sku": "",
        "price": 15490
      }
    }
  },
  "24192873": {
    "name": "PROYECTOR LED ULTRA SLIM 100W IP66 NEGRO C/ SENSOR DE MOVIMIENTO",
    "sku": "",
    "price": 20290,
    "variants": {
      "100489826": {
        "sku": "",
        "price": 20290
      }
    }
  },
  "24256942": {
    "name": "PROYECTOR LED ULTRA SLIM 150W IP66 NEGRO C/ SENSOR DE MOVIMIENTO",
    "sku": "",
    "price": 22690,
    "variants": {
      "100621990": {
        "sku": "",
        "price": 22690
      }
    }
  },
  "24257068": {
    "name": "PROYECTOR LED ULTRA SLIM 200W IP66 NEGRO C/ SENSOR DE MOVIMIENTO",
    "sku": "",
    "price": 27490,
    "variants": {
      "100622100": {
        "sku": "",
        "price": 27490
      }
    }
  },
  "24378602": {
    "name": "PANEL LED REDONDO SOBREPUESTO 12W IP44 NEGRO",
    "sku": "",
    "price": 3000,
    "variants": {
      "100817623": {
        "sku": "PLRS12C",
        "price": 3000
      },
      "120885664": {
        "sku": "",
        "price": 3000
      },
      "120885665": {
        "sku": "",
        "price": 3000
      }
    }
  },
  "24378703": {
    "name": "PANEL LED REDONDO SOBREPUESTO 18W IP44 NEGRO",
    "sku": "",
    "price": 5600,
    "variants": {
      "100885695": {
        "sku": "",
        "price": 5600
      },
      "120885666": {
        "sku": "",
        "price": 5600
      },
      "120885667": {
        "sku": "",
        "price": 5600
      }
    }
  },
  "24560180": {
    "name": "PANEL LED REDONDO SOBREPUESTO 24W IP44 NEGRO",
    "sku": "",
    "price": 7590,
    "variants": {
      "101027288": {
        "sku": "",
        "price": 7590
      },
      "120885668": {
        "sku": "",
        "price": 7590
      },
      "120885669": {
        "sku": "",
        "price": 7590
      }
    }
  },
  "24657400": {
    "name": "PROYECTOR LED DE ESTADIO MODULAR 100W IP66 IK10",
    "sku": "",
    "price": 101760,
    "variants": {
      "101312006": {
        "sku": "",
        "price": 101760
      },
      "115586181": {
        "sku": "",
        "price": 101760
      },
      "117590825": {
        "sku": "",
        "price": 101760
      }
    }
  },
  "24663380": {
    "name": "PROYECTOR LED DE ESTADIO MODULAR 200W IP66 IK10",
    "sku": "",
    "price": 114000,
    "variants": {
      "101312009": {
        "sku": "",
        "price": 114000
      },
      "115586119": {
        "sku": "",
        "price": 114000
      },
      "117590851": {
        "sku": "",
        "price": 114000
      }
    }
  },
  "24669150": {
    "name": "PROYECTOR LED DE ESTADIO MODULAR 300W IP66 IK10",
    "sku": "",
    "price": 179990,
    "variants": {
      "101312013": {
        "sku": "",
        "price": 179990
      },
      "115585933": {
        "sku": "",
        "price": 179990
      },
      "117590881": {
        "sku": "",
        "price": 179990
      }
    }
  },
  "24696340": {
    "name": "PROYECTOR LED DE ESTADIO MODULAR 400W IP66 IK10",
    "sku": "",
    "price": 323900,
    "variants": {
      "101383695": {
        "sku": "",
        "price": 323900
      },
      "115585828": {
        "sku": "",
        "price": 323900
      },
      "117590886": {
        "sku": "",
        "price": 323900
      }
    }
  },
  "24696451": {
    "name": "PROYECTOR LED DE ESTADIO MODULAR 600W IP66 IK10",
    "sku": "",
    "price": 429900,
    "variants": {
      "101383761": {
        "sku": "",
        "price": 429900
      },
      "115585822": {
        "sku": "",
        "price": 429900
      },
      "116874527": {
        "sku": "",
        "price": 429900
      }
    }
  },
  "24697125": {
    "name": "PROYECTOR LED DE ESTADIO MODULAR 1000W IP66 IK10",
    "sku": "",
    "price": 689900,
    "variants": {
      "101398930": {
        "sku": "",
        "price": 689900
      },
      "115585846": {
        "sku": "",
        "price": 689900
      },
      "117590890": {
        "sku": "",
        "price": 689900
      }
    }
  },
  "24698439": {
    "name": "PROYECTOR LED DE ESTADIO MODULAR 500W IP66 IK10",
    "sku": "",
    "price": 359900,
    "variants": {
      "101405875": {
        "sku": "",
        "price": 359900
      },
      "115585793": {
        "sku": "",
        "price": 359900
      },
      "117590887": {
        "sku": "",
        "price": 359900
      }
    }
  },
  "25714697": {
    "name": "PANEL LED RETRAÍDO OPAL 24W IP40",
    "sku": "",
    "price": 9440,
    "variants": {
      "103033375": {
        "sku": "DLRO40N",
        "price": 9440
      }
    }
  },
  "25714841": {
    "name": "PANEL LED RETRAÍDO OPAL 6W IP40",
    "sku": "",
    "price": 4640,
    "variants": {
      "103033507": {
        "sku": "DLRO40N",
        "price": 4640
      }
    }
  },
  "25818717": {
    "name": "ALUMBRADO PÚBLICO LED SOLAR 200W ALL IN ONE C/CONTROL REMOTO",
    "sku": "",
    "price": 106800,
    "variants": {
      "103125555": {
        "sku": "",
        "price": 106800
      },
      "122798073": {
        "sku": "",
        "price": 106800
      }
    }
  },
  "25885210": {
    "name": "ALUMBRADO PÚBLICO LED SOLAR 100W ALL IN ONE C/CONTROL REMOTO",
    "sku": "",
    "price": 96000,
    "variants": {
      "103206091": {
        "sku": "",
        "price": 96000
      },
      "103206092": {
        "sku": "",
        "price": 96000
      }
    }
  },
  "25888711": {
    "name": "ALUMBRADO PÚBLICO LED SOLAR 150W ALL IN ONE C/CONTROL REMOTO",
    "sku": "",
    "price": 102000,
    "variants": {
      "103206295": {
        "sku": "",
        "price": 102000
      },
      "103206296": {
        "sku": "",
        "price": 102000
      }
    }
  },
  "25888760": {
    "name": "ALUMBRADO PÚBLICO LED SOLAR 60W ALL IN ONE C/CONTROL REMOTO",
    "sku": "",
    "price": 81600,
    "variants": {
      "103206381": {
        "sku": "",
        "price": 81600
      },
      "103206382": {
        "sku": "",
        "price": 81600
      }
    }
  },
  "25891192": {
    "name": "PROYECTOR LED SOLAR 100W IP65 C/PANEL SOLAR C/CONTROL REMOTO",
    "sku": "PLS100",
    "price": 59900,
    "variants": {}
  },
  "25891958": {
    "name": "PROYECTOR LED SOLAR 150W IP65 C/PANEL SOLAR C/CONTROL REMOTO",
    "sku": "PLS150",
    "price": 69900,
    "variants": {}
  },
  "25892132": {
    "name": "PROYECTOR LED SOLAR 200W IP65 C/PANEL SOLAR C/CONTROL REMOTO",
    "sku": "PLS200",
    "price": 89900,
    "variants": {}
  },
  "26797242": {
    "name": "LINEAL LED SUSPENDIDA 36W 120 CM NEGRA",
    "sku": "",
    "price": 30960,
    "variants": {
      "104403454": {
        "sku": "",
        "price": 30960
      },
      "104403455": {
        "sku": "",
        "price": 30960
      },
      "104403456": {
        "sku": "",
        "price": 30960
      }
    }
  },
  "26797442": {
    "name": "LINEAL LED SUSPENDIDA 36W 120 CM BLANCA",
    "sku": "",
    "price": 30960,
    "variants": {
      "104403732": {
        "sku": "",
        "price": 30960
      },
      "104403733": {
        "sku": "",
        "price": 30960
      },
      "104403734": {
        "sku": "",
        "price": 30960
      }
    }
  },
  "26946977": {
    "name": "ALUMBRADO PÚBLICO LED SOLAR 300W ALL IN ONE INDUSTRIAL C/ CONTROL REMOTO",
    "sku": "APS300PF",
    "price": 238800,
    "variants": {
      "110677528": {
        "sku": "APS300PF",
        "price": 238800
      },
      "110677529": {
        "sku": "APS300PF",
        "price": 238800
      },
      "110677530": {
        "sku": "APS300PF",
        "price": 238800
      },
      "110677531": {
        "sku": "APS300PF",
        "price": 238800
      }
    }
  },
  "27936170": {
    "name": "PAGODA LED SOLAR UFO 300W ALL IN ONE",
    "sku": "",
    "price": 190800,
    "variants": {
      "106138466": {
        "sku": "PLSU300N",
        "price": 190800
      },
      "120597812": {
        "sku": "PLSU300A",
        "price": 190800
      },
      "120597915": {
        "sku": "PLSU300C",
        "price": 190800
      },
      "120597916": {
        "sku": "PLSU300F",
        "price": 190800
      }
    }
  },
  "27987505": {
    "name": "FOCO LED A RIEL MONOFÁSICO 30W NEGRO TODOS LOS COLORES",
    "sku": "",
    "price": 21501,
    "variants": {
      "106285792": {
        "sku": "",
        "price": 21501
      },
      "106285793": {
        "sku": "",
        "price": 21501
      }
    }
  },
  "28033116": {
    "name": "FOCO LED A RIEL MONOFÁSICO 10W",
    "sku": "",
    "price": 8900,
    "variants": {
      "106317008": {
        "sku": "",
        "price": 8900
      },
      "106317009": {
        "sku": "",
        "price": 8900
      },
      "106317010": {
        "sku": "",
        "price": 8900
      }
    }
  },
  "28035334": {
    "name": "APLIQUE LED DE MURO 2X6W IP65",
    "sku": "",
    "price": 18900,
    "variants": {
      "106320060": {
        "sku": "AL6PMC",
        "price": 18900
      }
    }
  },
  "28172883": {
    "name": "APLIQUE DECORATIVO BAZUCA BIDIRECCIONAL MINI 2x5W IP65 NEGRO",
    "sku": "",
    "price": 14190,
    "variants": {
      "106672292": {
        "sku": "ADCE2X5NC",
        "price": 14190
      }
    }
  },
  "28622352": {
    "name": "APLIQUE DECORATIVO BAZUCA BIDIRECCIONAL 2x10W IP65 NEGRO",
    "sku": "",
    "price": 20200,
    "variants": {
      "107448697": {
        "sku": "ADCE2X5NC",
        "price": 20200
      }
    }
  },
  "28648231": {
    "name": "PROYECTOR LED SOLAR 200W IP66 C/PANEL SOLAR C/CONTROL REMOTO (GRIS)",
    "sku": "PLSG200F",
    "price": 69900,
    "variants": {}
  },
  "28651673": {
    "name": "PROYECTOR LED SOLAR 100W IP66 C/PANEL SOLAR C/CONTROL REMOTO (GRIS)",
    "sku": "PLSG100F",
    "price": 45600,
    "variants": {}
  },
  "28666518": {
    "name": "PROYECTOR LED SOLAR 300W IP66 C/PANEL SOLAR C/CONTROL REMOTO (GRIS)",
    "sku": "PLSG300F",
    "price": 69900,
    "variants": {}
  },
  "28668257": {
    "name": "PROYECTOR LED SOLAR 150W IP66 C/PANEL SOLAR C/CONTROL REMOTO (GRIS)",
    "sku": "PLSG150F",
    "price": 57600,
    "variants": {}
  },
  "29535391": {
    "name": "PANEL LED COLGANTE REDONDO 48W IP44 NEGRO",
    "sku": "",
    "price": 35790,
    "variants": {
      "108896327": {
        "sku": "",
        "price": 35790
      },
      "120885670": {
        "sku": "",
        "price": 35790
      },
      "120885671": {
        "sku": "",
        "price": 35790
      }
    }
  },
  "29536021": {
    "name": "ARO DE LUZ LED COLGANTE 48W IP44 NEGRO",
    "sku": "",
    "price": 35790,
    "variants": {
      "108896334": {
        "sku": "",
        "price": 35790
      },
      "120885672": {
        "sku": "",
        "price": 35790
      },
      "120885673": {
        "sku": "",
        "price": 35790
      }
    }
  },
  "30511210": {
    "name": "ALUMBRADO PÚBLICO LED SOLAR 600W ALL IN ONE INDUSTRIAL C/ CONTROL REMOTO",
    "sku": "APS400PF",
    "price": 619900,
    "variants": {
      "110660215": {
        "sku": "APS600PC",
        "price": 619900
      },
      "110660216": {
        "sku": "APS600PN",
        "price": 619900
      },
      "110660217": {
        "sku": "APS600PC",
        "price": 619900
      },
      "110660218": {
        "sku": "APS600PF",
        "price": 619900
      }
    }
  },
  "30518805": {
    "name": "ALUMBRADO PÚBLICO LED SOLAR 400W ALL IN ONE INDUSTRIAL C/ CONTROL REMOTO",
    "sku": "APS600PF",
    "price": 359900,
    "variants": {
      "110660366": {
        "sku": "APS600PC",
        "price": 359900
      },
      "110660367": {
        "sku": "APS600PN",
        "price": 359900
      },
      "110660368": {
        "sku": "APS600PC",
        "price": 359900
      },
      "110660369": {
        "sku": "APS600PF",
        "price": 359900
      }
    }
  },
  "30534071": {
    "name": "ALUMBRADO PÚBLICO LED SOLAR 200W ALL IN ONE INDUSTRIAL C/ CONTROL REMOTO",
    "sku": "APS300PF",
    "price": 153600,
    "variants": {
      "110677475": {
        "sku": "APS200SALLC",
        "price": 153600
      },
      "110677476": {
        "sku": "APS200SALLN",
        "price": 153600
      },
      "110677477": {
        "sku": "APS200SALLC",
        "price": 153600
      },
      "110677478": {
        "sku": "APS200SALLF",
        "price": 153600
      }
    }
  },
  "31518788": {
    "name": "CAMPANA LED UFO REGULABLE 200W 150LM/W IP66 IK10",
    "sku": "",
    "price": 63600,
    "variants": {
      "112625303": {
        "sku": "",
        "price": 63600
      }
    }
  },
  "31731832": {
    "name": "PROYECTOR LED CANOPY 200W IP66 IK10",
    "sku": "PLAPEX200F",
    "price": 321600,
    "variants": {}
  },
  "32404303": {
    "name": "LINEAL LED EMBUTIDO EN PISO 28W",
    "sku": "",
    "price": 84990,
    "variants": {
      "114560030": {
        "sku": "FLEP18C",
        "price": 84990
      }
    }
  },
  "32913027": {
    "name": "PROYECTOR LED DE ESTADIO MODULAR 800W IP66 IK10",
    "sku": "",
    "price": 561600,
    "variants": {
      "115763017": {
        "sku": "",
        "price": 561600
      },
      "117590910": {
        "sku": "",
        "price": 561600
      },
      "117590911": {
        "sku": "",
        "price": 561600
      },
      "117590912": {
        "sku": "",
        "price": 561600
      }
    }
  },
  "32913142": {
    "name": "PROYECTOR LED DE ESTADIO MODULAR 150W IP66 IK10",
    "sku": "",
    "price": 129600,
    "variants": {
      "115763122": {
        "sku": "",
        "price": 129600
      },
      "115763124": {
        "sku": "",
        "price": 129600
      },
      "117590901": {
        "sku": "",
        "price": 129600
      }
    }
  },
  "32954808": {
    "name": "CAMPANA LED UFO NF9 400W 110 Lm/ IP65 44.000 Lm.",
    "sku": "UFOP400F",
    "price": 159900,
    "variants": {}
  },
  "33412578": {
    "name": "PROYECTOR LED A PRUEBA DE EXPLOSIÓN SQUARE 50W",
    "sku": "PLAPEXS50",
    "price": 189900,
    "variants": {}
  },
  "33412879": {
    "name": "PROYECTOR LED A PRUEBA DE EXPLOSIÓN SQUARE 100W",
    "sku": "PLAPEXS100",
    "price": 201600,
    "variants": {}
  },
  "33413008": {
    "name": "PROYECTOR LED A PRUEBA DE EXPLOSIÓN SQUARE 200W",
    "sku": "PLAPEXS200",
    "price": 321600,
    "variants": {}
  },
  "33554875": {
    "name": "CAMPANA LED UFO NF7 100W 120LM/W IP65",
    "sku": "",
    "price": 24000,
    "variants": {
      "117165891": {
        "sku": "",
        "price": 24000
      }
    }
  },
  "33597212": {
    "name": "CAMPANA LED UFO NF7 150W 120LM/W IP65",
    "sku": "",
    "price": 21900,
    "variants": {
      "117216175": {
        "sku": "",
        "price": 21900
      }
    }
  },
  "33610052": {
    "name": "CAMPANA LED UFO NF7 200W 120LM/W IP65",
    "sku": "",
    "price": 28900,
    "variants": {
      "117248971": {
        "sku": "",
        "price": 28900
      }
    }
  },
  "33736073": {
    "name": "CAMPANA LED UFO NF9 100W 110LM/W IP65 11.000 Lm.",
    "sku": "",
    "price": 22000,
    "variants": {
      "117393879": {
        "sku": "",
        "price": 22000
      },
      "117394400": {
        "sku": "",
        "price": 22000
      },
      "117394401": {
        "sku": "",
        "price": 22000
      }
    }
  },
  "33748536": {
    "name": "CAMPANA LED UFO NF9 150W 110LM/W IP65 16.500 Lm.",
    "sku": "",
    "price": 20900,
    "variants": {
      "117397141": {
        "sku": "",
        "price": 20900
      },
      "117397142": {
        "sku": "",
        "price": 20900
      },
      "117397143": {
        "sku": "",
        "price": 20900
      }
    }
  },
  "33748560": {
    "name": "CAMPANA LED UFO NF9 200W 110LM/W IP65 22.000 Lm.",
    "sku": "",
    "price": 28900,
    "variants": {
      "117397151": {
        "sku": "",
        "price": 28900
      },
      "117397152": {
        "sku": "",
        "price": 28900
      },
      "117397153": {
        "sku": "",
        "price": 28900
      }
    }
  },
  "34057374": {
    "name": "PROYECTOR LED SOLAR 500W IP65 C/PANEL SOLAR C/CONTROL REMOTO",
    "sku": "PLS500",
    "price": 124900,
    "variants": {}
  },
  "35794580": {
    "name": "Luminaria de Emergencia LED 1000 Lúmenes - 2 Faros",
    "sku": "30070",
    "price": 52836,
    "variants": {}
  },
  "35808441": {
    "name": "LUMINARIA DE EMERGENCIA LED 6W 2 FAROS 410 LÚMENES",
    "sku": "30146",
    "price": 23681,
    "variants": {}
  },
  "37039738": {
    "name": "SEÑALÉTICA DE EMERGENCIA LED SLIM 24 X 18 CM. SALIDA",
    "sku": "33716",
    "price": 19900,
    "variants": {}
  },
  "37404730": {
    "name": "CAMPANA LED UFO A PRUEBA DE EXPLOSIÓN 300W",
    "sku": "PLAPEX300F",
    "price": 321600,
    "variants": {}
  }
};
